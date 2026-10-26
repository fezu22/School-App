import { parentApi } from "./parentService";

export const money = (amount) =>
  `PKR ${Number(amount).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
const finite = (value) =>
  value !== null &&
  value !== undefined &&
  value !== "" &&
  Number.isFinite(Number(value)) &&
  Number(value) >= 0;
export const keyOf = (invoice) => `${invoice.childId}:${invoice.id}`;
export function selectable(invoice) {
  return (
    invoice.currency === "PKR" &&
    finite(invoice.availableBalance) &&
    Number(invoice.availableBalance) > 0 &&
    !invoice.error
  );
}
export function selectionTotal(invoices, keys) {
  return (
    Math.round(
      invoices
        .filter((item) => keys.includes(keyOf(item)) && selectable(item))
        .reduce((sum, item) => sum + Number(item.availableBalance), 0) * 100
    ) / 100
  );
}
export async function loadParentPaymentInvoices() {
  const children = await parentApi.getChildren();
  if (!Array.isArray(children))
    throw new Error("Unexpected linked-child response.");
  const results = await Promise.allSettled(
    children.map(async (child) => {
      const childId = String(child.id || child._id || "");
      if (!childId) throw new Error("Linked child has no API ID.");
      const fees = await parentApi.getFees(childId);
      if (!Array.isArray(fees)) throw new Error("Unexpected invoice response.");
      return fees.map((fee) => ({
        id: String(fee.id || fee._id || ""),
        childId,
        childName: child.fullName || child.name || "Your child",
        classLabel: [
          child.grade &&
            `Class ${String(child.grade).replace(/^Grade\s*/i, "")}`,
          child.section,
        ]
          .filter(Boolean)
          .join("-"),
        invoiceNumber: fee.invoiceNumber || fee.id || "Invoice",
        period: fee.period || fee.month || "Other / unspecified period",
        currency: fee.currency || "PKR",
        amount: fee.amount,
        paidAmount: fee.paidAmount,
        pendingAmount: fee.pendingAmount,
        balanceDue: fee.balanceDue,
        availableBalance: fee.availableBalance,
        // Never invent a tuition/transport/paper breakdown from the invoice total.
        lineItems: Array.isArray(fee.lineItems) ? fee.lineItems : [],
        error: !fee.id && !fee._id ? "Invoice API ID is missing." : "",
      }));
    })
  );
  return {
    invoices: results.flatMap((result) =>
      result.status === "fulfilled" ? result.value : []
    ),
    errors: results.flatMap((result, i) =>
      result.status === "rejected"
        ? [
            `${children[i].fullName || "Child"}: ${
              result.reason?.message || "Fees unavailable"
            }`,
          ]
        : []
    ),
  };
}
export function validateConfirmedReceipt(receipt, selected) {
  if (
    receipt?.status !== "confirmed" ||
    !receipt.id ||
    receipt.currency !== "PKR" ||
    !Array.isArray(receipt.allocations)
  )
    return false;
  if (receipt.allocations.length !== selected.length || !finite(receipt.amount))
    return false;
  const seen = new Set();
  for (const allocation of receipt.allocations) {
    const key = `${allocation.childId}:${allocation.invoiceId}`;
    if (
      seen.has(key) ||
      !selected.some((item) => keyOf(item) === key) ||
      !finite(allocation.amount) ||
      Number(allocation.amount) !==
        Number(
          selected.find((item) => keyOf(item) === key)?.availableBalance
        ) ||
      !finite(allocation.remainingBalance)
    )
      return false;
    seen.add(key);
  }
  const allocated = receipt.allocations.reduce(
    (sum, item) => sum + Number(item.amount),
    0
  );
  return (
    Math.round(allocated * 100) === Math.round(Number(receipt.amount) * 100)
  );
}
