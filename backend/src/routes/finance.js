import { Router } from "express";
import { z } from "zod";
import { Invoice, Payment, Student } from "../models/index.js";
import {
  auth,
  allow,
  route,
  problem,
  getStudent,
  studentFilter,
} from "../middleware/auth.js";
import { id, text, date } from "../config/validation.js";
import { audit } from "../services/audit.js";
export const router = Router();
router.use(
  auth,
  allow("SUPER_ADMIN", "PRINCIPAL", "ACCOUNTANT", "PARENT", "STUDENT")
);
router.get(
  "/",
  route(async (req, res) => {
    const students = await Student.find(await studentFilter(req.user)).select(
      "_id"
    );
    const invoices = await Invoice.find({
      studentId: { $in: students.map((s) => s._id) },
    })
      .populate("studentId", "name admissionNumber")
      .sort({ createdAt: -1 });
    const items = await Promise.all(
      invoices.map(async (i) => {
        const payments = await Payment.find({ invoiceId: i._id });
        const paid = payments.reduce((n, p) => n + p.amount, 0);
        return { ...i.toObject(), paid, balance: i.amount - paid, payments };
      })
    );
    res.json({ items });
  })
);
router.post(
  "/",
  allow("SUPER_ADMIN", "ACCOUNTANT"),
  route(async (req, res) => {
    const data = z
      .object({
        studentId: id,
        title: text,
        amount: z.number().int().min(1).max(100000000),
        dueDate: date,
      })
      .parse(req.body);
    const student = await getStudent(req.user, data.studentId);
    const item = await Invoice.create({ ...data, branchId: student.branchId });
    await audit(req.user, "CREATE", "Invoice", item._id, item.branchId);
    res.status(201).json({ item });
  })
);
// Use database transactions to prevent concurrent overpayment; requires replica set/Atlas.
router.post(
  "/:id/payments",
  allow("SUPER_ADMIN", "ACCOUNTANT"),
  route(async (req, res) => {
    const data = z
      .object({
        amount: z.number().int().min(1),
        method: z.enum(["CASH", "BANK", "CHEQUE"]),
        reference: z.string().max(100).default(""),
        requestKey: z.string().min(12).max(100),
      })
      .parse(req.body);
    const invoice = await Invoice.findById(id.parse(req.params.id));
    if (!invoice) throw problem(404, "Invoice not found");
    await getStudent(req.user, invoice.studentId);
    const prior = await Payment.findOne({ requestKey: data.requestKey });
    if (prior) {
      if (
        String(prior.invoiceId) !== String(invoice._id) ||
        prior.amount !== data.amount
      )
        throw problem(409, "Payment request conflict");
      return res.json({ item: prior });
    }
    let item;
    const session = await Invoice.startSession();
    try {
      await session.withTransaction(async () => {
        await Invoice.updateOne(
          { _id: invoice._id },
          { $inc: { paymentRevision: 1 } },
          { session }
        );
        const payments = await Payment.find({ invoiceId: invoice._id }).session(
          session
        );
        const balance =
          invoice.amount - payments.reduce((n, p) => n + p.amount, 0);
        if (data.amount > balance)
          throw problem(400, "Payment exceeds balance");
        [item] = await Payment.create(
          [{ ...data, invoiceId: invoice._id, recordedBy: req.user._id }],
          { session }
        );
      });
    } finally {
      await session.endSession();
    }
    await audit(req.user, "PAY", "Invoice", invoice._id, invoice.branchId);
    res.status(201).json({ item });
  })
);
