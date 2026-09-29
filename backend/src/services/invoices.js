import { Invoice, Payment, Student } from "../models/index.js";
import { studentFilter } from "../middleware/auth.js";

// Invoices (with payments and balance) for the students this user may see.
export async function listInvoices(user) {
  const students = await Student.find(await studentFilter(user)).select("_id");
  const invoices = await Invoice.find({
    studentId: { $in: students.map((s) => s._id) },
  })
    .populate("studentId", "name admissionNumber")
    .sort({ createdAt: -1 });
  return Promise.all(
    invoices.map(async (i) => {
      const payments = await Payment.find({ invoiceId: i._id });
      const paid = payments.reduce((n, p) => n + p.amount, 0);
      return { ...i.toObject(), paid, balance: i.amount - paid, payments };
    })
  );
}
