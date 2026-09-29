import { Router } from "express";
import { z } from "zod";
import { Invoice, Payment } from "../../models/index.js";
import { allow, route, problem, getStudent } from "../../middleware/auth.js";
import { id, text, date } from "../../config/validation.js";
import { audit } from "../../services/audit.js";
import { listInvoices } from "../../services/invoices.js";

// Mounted at /staff/invoices. Principal can view; only super admin can create/pay.
export const router = Router();
router.get(
  "/",
  allow("SUPER_ADMIN", "PRINCIPAL"),
  route(async (req, res) => res.json({ items: await listInvoices(req.user) }))
);
router.post(
  "/",
  allow("SUPER_ADMIN"),
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
  allow("SUPER_ADMIN"),
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
