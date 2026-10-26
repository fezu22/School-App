import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  ImageBackground,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  keyOf,
  loadParentPaymentInvoices,
  money,
  selectable,
  selectionTotal,
  validateConfirmedReceipt,
} from "./parentPaymentDesignModel";
import { paymentDesignInvoices } from "./parentPaymentDesignPreview";
import { parentApi } from "./parentService";

const palette = {
  cream: "#FFF9F0",
  navy: "#2C3556",
  indigo: "#4B56BD",
  muted: "#74868E",
  border: "#EEE1D0",
  mint: "#E9F2DE",
  yellow: "#FFF0C9",
  lavender: "#EDEBFF",
};
const methods = [
  ["card", "▣", "Card", "Debit or credit card"],
  ["easypaisa", "e", "Easypaisa", "Pay with your Easypaisa account"],
  ["jazzcash", "J", "JazzCash", "Pay with your JazzCash account"],
];
const amountLabel = (value) =>
  value == null || value === "" || !Number.isFinite(Number(value))
    ? "Unavailable"
    : money(value);
const safeUrl = (value) =>
  typeof value === "string" && /^https:\/\/[^\s]+$/i.test(value);
function Button({ children, onPress, disabled, secondary }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={typeof children === "string" ? children : undefined}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondary,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, secondary && styles.secondaryText]}>
        {children}
      </Text>
    </Pressable>
  );
}
function Row({ label, value, emphasis, green }) {
  return (
    <View style={[styles.row, emphasis && styles.amountRow]}>
      <Text style={[styles.rowLabel, emphasis && styles.bold]}>{label}</Text>
      <Text
        style={[
          styles.rowValue,
          emphasis && styles.bold,
          green && styles.green,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}
function Avatar({ index, preview = false }) {
  return (
    <View
      style={[
        styles.avatar,
        { backgroundColor: index % 2 ? "#F9DFED" : "#E2EBF8" },
      ]}
    >
      <Text style={styles.avatarText}>{index % 2 ? "👧" : "👦"}</Text>
    </View>
  );
}
function Hero({ receipt }) {
  return (
    <ImageBackground
      source={require("../../assets/school-art.webp")}
      resizeMode="cover"
      imageStyle={styles.heroImage}
      style={styles.hero}
    >
      <View style={styles.heroCopy}>
        <Text style={styles.eyebrow}>
          {receipt ? "THANK YOU" : "A SUPPORTIVE JOURNEY"}
        </Text>
        <Text style={styles.heroTitle}>
          {receipt
            ? "Together for a brighter future."
            : "Investing in a brighter tomorrow."}
        </Text>
      </View>
    </ImageBackground>
  );
}

// Render inside the existing MobileApp shell: its header/drawer and bottom bar stay intact.
// checkoutAdapter must be implemented against the real multi-invoice gateway API.
export default function ParentMultiChildPayment({
  previewOnly = false,
  previewScreen = "fees",
  checkoutAdapter,
  onNavigate,
}) {
  const preview = previewOnly && typeof __DEV__ !== "undefined" && __DEV__;
  const [invoices, setInvoices] = useState(
    preview ? paymentDesignInvoices : []
  );
  const [selectedKeys, setSelectedKeys] = useState(
    preview ? paymentDesignInvoices.map(keyOf) : []
  );
  const [period, setPeriod] = useState(
    preview ? "October 2026" : "All periods"
  );
  const [step, setStep] = useState(preview ? previewScreen : "fees");
  const [method, setMethod] = useState("card");
  const [loading, setLoading] = useState(!preview),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [receipt, setReceipt] = useState(null),
    [checkoutId, setCheckoutId] = useState("");
  const [gateway, setGateway] = useState({ enabled: false, methods: [] });
  const request = useRef(0),
    retryKey = useRef(""),
    inFlight = useRef(false),
    pendingItems = useRef([]);
  const periods = [...new Set(invoices.map((item) => item.period))];
  const visible = invoices.filter(
    (item) => period === "All periods" || item.period === period
  );
  const selected = visible.filter(
    (item) => selectedKeys.includes(keyOf(item)) && selectable(item)
  );
  const total = selectionTotal(visible, selectedKeys);
  const activeAdapter = checkoutAdapter || {
    enabled: gateway.enabled,
    methods: gateway.methods,
    createBatchCheckout: parentApi.createBatchCheckout,
    getBatchStatus: parentApi.getBatchPaymentStatus,
  };
  const enabledMethods = preview
    ? methods.map((item) => item[0])
    : activeAdapter.methods || [];
  const supported =
    !preview &&
    activeAdapter.enabled === true &&
    typeof activeAdapter.createBatchCheckout === "function" &&
    typeof activeAdapter.getBatchStatus === "function";
  const load = useCallback(async () => {
    if (preview || checkoutId || inFlight.current) return;
    const version = ++request.current;
    setLoading(true);
    setError("");
    setSelectedKeys([]);
    setInvoices([]);
    retryKey.current = "";
    try {
      const [value, config] = await Promise.all([
        loadParentPaymentInvoices(),
        parentApi.getFeeCheckoutConfig(),
      ]);
      if (version === request.current) {
        setInvoices(value.invoices);
        setGateway(config || { enabled: false, methods: [] });
        setError(value.errors.join("\n"));
      }
    } catch (failure) {
      if (version === request.current)
        setError(failure.message || "Could not load fees.");
    } finally {
      if (version === request.current) setLoading(false);
    }
  }, [checkoutId, preview]);
  useEffect(() => {
    load();
    return () => {
      request.current += 1;
    };
  }, [load]); // identity changes must remount this screen
  function toggle(item) {
    if (checkoutId || busy || !selectable(item)) return;
    retryKey.current = "";
    setSelectedKeys((keys) =>
      keys.includes(keyOf(item))
        ? keys.filter((key) => key !== keyOf(item))
        : [...keys, keyOf(item)]
    );
  }
  function choosePeriod(value) {
    if (checkoutId || busy) return;
    setPeriod(value);
    setSelectedKeys([]);
    retryKey.current = "";
  }
  async function startCheckout() {
    if (preview) {
      setError("Design preview only. No payment was processed.");
      return;
    }
    if (
      !supported ||
      !enabledMethods.includes(method) ||
      !selected.length ||
      inFlight.current ||
      checkoutId
    )
      return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    const version = request.current;
    // Keep this same key for uncertain retries of an unchanged invoice/method selection.
    retryKey.current ||= `parent-batch-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;
    try {
      const value = await activeAdapter.createBatchCheckout({
        invoices: selected.map((item) => ({
          childId: item.childId,
          invoiceId: item.id,
        })),
        method,
        idempotencyKey: retryKey.current,
      });
      if (version !== request.current) return;
      if (!value?.id || !safeUrl(value.checkoutUrl))
        throw new Error("Invalid secure checkout response.");
      pendingItems.current = selected;
      setCheckoutId(String(value.id));
      setStep("pending");
      await Linking.openURL(value.checkoutUrl);
    } catch (failure) {
      if (version === request.current)
        setError(
          failure.message ||
            "Checkout unavailable. Retry or check payment status."
        );
    } finally {
      inFlight.current = false;
      if (version === request.current) setBusy(false);
    }
  }
  async function checkStatus() {
    if (!checkoutId || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    const version = request.current;
    try {
      const value = await activeAdapter.getBatchStatus(checkoutId);
      if (version !== request.current) return;
      if (value.status === "confirmed") {
        if (!validateConfirmedReceipt(value.receipt, pendingItems.current))
          throw new Error(
            "Receipt allocation is unavailable or inconsistent. Contact Finance."
          );
        setReceipt(value.receipt);
        setStep("receipt");
      } else if (value.status === "failed" || value.status === "cancelled") {
        // Adapter may report terminal failure only after server-side provider verification.
        if (value.reservationReleased !== true) {
          setError("Payment requires reconciliation. Please contact Finance.");
          return;
        }
        setCheckoutId("");
        pendingItems.current = [];
        retryKey.current = "";
        setStep("fees");
        inFlight.current = false;
        setBusy(false);
        await load();
      } else
        setError(
          "Payment is pending verification. Do not pay again; check status later."
        );
    } catch (failure) {
      if (version === request.current)
        setError(failure.message || "Could not check payment status.");
    } finally {
      inFlight.current = false;
      if (version === request.current) setBusy(false);
    }
  }
  const displayReceipt =
    preview && step === "receipt"
      ? {
          id: "RCP-00025",
          amount: 9000,
          method: "Card",
          period: "October 2026",
          allocations: paymentDesignInvoices.map((item) => ({
            childId: item.childId,
            invoiceId: item.id,
            amount: item.availableBalance,
            remainingBalance: 0,
          })),
        }
      : receipt;
  const receiptItems = preview ? paymentDesignInvoices : pendingItems.current;
  async function download(individual = false) {
    if (preview) {
      setError("Design preview — no real receipt exists.");
      return;
    }
    try {
      if (individual) {
        if (!activeAdapter.openIndividualReceipts)
          throw new Error("Individual receipt download is not connected.");
        await activeAdapter.openIndividualReceipts(displayReceipt);
      } else {
        if (!activeAdapter.downloadReceipt)
          throw new Error("Receipt download is not connected.");
        await activeAdapter.downloadReceipt(displayReceipt.id);
      }
    } catch (failure) {
      setError(failure.message);
    }
  }
  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={load}
            enabled={!checkoutId && !busy}
            tintColor={palette.indigo}
          />
        }
      >
        {step !== "fees" && step !== "pending" && step !== "receipt" ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              if (!busy) {
                setStep("fees");
                setError("");
              }
            }}
          >
            <Text style={styles.back}>‹ Invoice selection</Text>
          </Pressable>
        ) : null}
        <Text style={styles.title}>
          {step === "fees"
            ? "Their fees, together."
            : step === "method"
            ? `One payment. ${
                new Set(selected.map((item) => item.childId)).size
              } ${
                new Set(selected.map((item) => item.childId)).size === 1
                  ? "child"
                  : "children"
              }.`
            : step === "pending"
            ? "Checking your payment."
            : preview
            ? "Receipt design preview"
            : "Payment confirmed"}
        </Text>
        <Text style={styles.subtitle}>
          {step === "fees"
            ? "Select children to pay in one checkout."
            : step === "method"
            ? "Review the total and choose how to pay."
            : step === "pending"
            ? "Closing checkout does not confirm or cancel a payment."
            : preview
            ? "Sample receipt layout only. No payment was processed."
            : "Your payment has been verified by the server."}
        </Text>
        {preview ? (
          <Text style={styles.preview}>
            DESIGN PREVIEW · SAMPLE DATA · NO REAL PAYMENT
          </Text>
        ) : null}
        {loading || busy ? <ActivityIndicator color={palette.indigo} /> : null}
        {error ? (
          <View style={styles.error}>
            <Text accessibilityRole="alert" style={styles.errorText}>
              {error}
            </Text>
          </View>
        ) : null}
        {step === "fees" ? (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.periods}
            >
              {["All periods", ...periods].map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: period === value }}
                  disabled={busy || !!checkoutId}
                  onPress={() => choosePeriod(value)}
                  style={[
                    styles.period,
                    period === value && styles.periodActive,
                  ]}
                >
                  <Text style={styles.periodText}>▣ {value}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{
                checked:
                  visible.filter(selectable).length > 0 &&
                  visible
                    .filter(selectable)
                    .every((item) => selectedKeys.includes(keyOf(item))),
              }}
              disabled={busy || !!checkoutId}
              onPress={() => {
                const eligible = visible.filter(selectable).map(keyOf);
                retryKey.current = "";
                setSelectedKeys(
                  eligible.every((key) => selectedKeys.includes(key))
                    ? []
                    : eligible
                );
              }}
              style={styles.selectAll}
            >
              <Text style={styles.bold}>
                {visible.filter(selectable).length &&
                visible
                  .filter(selectable)
                  .every((item) => selectedKeys.includes(keyOf(item)))
                  ? "☑"
                  : "☐"}{" "}
                Select all ({visible.filter(selectable).length} invoices)
              </Text>
              <Text style={styles.small}>{selected.length} selected</Text>
            </Pressable>
            {!loading && !visible.length ? (
              <View style={styles.card}>
                <Text style={styles.subtitle}>
                  No invoices available for this selection.
                </Text>
                <Button secondary onPress={load}>
                  Refresh fees
                </Button>
              </View>
            ) : null}
            {visible.map((item, index) => (
              <View
                key={keyOf(item)}
                style={[
                  styles.card,
                  selectedKeys.includes(keyOf(item)) && styles.selectedCard,
                ]}
              >
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel={`Select ${item.childName} ${item.invoiceNumber}`}
                  accessibilityState={{
                    checked: selectedKeys.includes(keyOf(item)),
                    disabled: !selectable(item),
                  }}
                  disabled={busy || !!checkoutId || !selectable(item)}
                  onPress={() => toggle(item)}
                  style={styles.childHeader}
                >
                  <Avatar index={index} preview={preview} />
                  <View style={styles.flex}>
                    <Text style={styles.childName}>{item.childName}</Text>
                    <Text style={styles.subtitle}>{item.classLabel}</Text>
                    <Text style={styles.small}>{item.invoiceNumber}</Text>
                  </View>
                  <Text style={styles.checkbox}>
                    {selectedKeys.includes(keyOf(item)) ? "☑" : "☐"}
                  </Text>
                </Pressable>
                {item.lineItems.length ? (
                  item.lineItems.map((line, i) => (
                    <Row
                      key={i}
                      label={line.label || line.description || "School charge"}
                      value={amountLabel(line.amount)}
                    />
                  ))
                ) : (
                  <Text style={styles.small}>
                    Itemized school charges are not supplied by this invoice.
                  </Text>
                )}
                <View style={styles.divider} />
                <Row label="Invoice total" value={amountLabel(item.amount)} />
                <Row
                  label="Already paid"
                  value={amountLabel(item.paidAmount)}
                  green
                />
                {Number(item.pendingAmount) > 0 ? (
                  <Row
                    label="Pending verification"
                    value={amountLabel(item.pendingAmount)}
                  />
                ) : null}
                <Row
                  label="Amount due"
                  value={amountLabel(item.balanceDue)}
                  emphasis
                />
                {Number(item.availableBalance) !== Number(item.balanceDue) ? (
                  <Row
                    label="Available to pay"
                    value={amountLabel(item.availableBalance)}
                  />
                ) : null}
                {item.error ? (
                  <Text style={styles.errorText}>{item.error}</Text>
                ) : null}
              </View>
            ))}
            <Button secondary onPress={() => onNavigate?.("Receipt Details")}>
              View past receipts
            </Button>
            {preview ? (
              <Button secondary onPress={() => setStep("receipt")}>
                Preview receipt layout
              </Button>
            ) : null}
          </>
        ) : step === "method" ? (
          <>
            <View style={styles.card}>
              <Text style={styles.panelTitle}>Payment breakdown</Text>
              {selected.map((item, index) => (
                <View key={keyOf(item)} style={styles.breakdown}>
                  <Avatar index={index} preview={preview} />
                  <View style={styles.flex}>
                    <Text style={styles.childName}>{item.childName}</Text>
                    <Text style={styles.small}>
                      {item.classLabel} · {item.period}
                    </Text>
                  </View>
                  <Text style={styles.bold}>
                    {money(item.availableBalance)}
                  </Text>
                </View>
              ))}
              <Row label="Total to pay" value={money(total)} emphasis />
            </View>
            <View style={styles.card}>
              <Text style={styles.panelTitle}>Choose a payment method</Text>
              {methods.map(([id, icon, label, note]) => (
                <Pressable
                  key={id}
                  accessibilityRole="radio"
                  accessibilityState={{
                    selected: method === id,
                    disabled: !enabledMethods.includes(id),
                  }}
                  disabled={busy || !enabledMethods.includes(id)}
                  onPress={() => {
                    if (method !== id) retryKey.current = "";
                    setMethod(id);
                  }}
                  style={[
                    styles.method,
                    method === id && styles.methodActive,
                    !enabledMethods.includes(id) && styles.disabled,
                  ]}
                >
                  <Text style={styles.radio}>{method === id ? "◉" : "○"}</Text>
                  <Text
                    style={[
                      styles.methodIcon,
                      id === "easypaisa" && styles.green,
                    ]}
                  >
                    {icon}
                  </Text>
                  <View style={styles.flex}>
                    <Text style={styles.childName}>{label}</Text>
                    <Text style={styles.small}>
                      {enabledMethods.includes(id) ? note : "Not connected yet"}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
            <View style={styles.secure}>
              <Text style={styles.secureText}>
                ▣ Secure provider checkout.{"\n"}Payment details are entered
                with the provider.
              </Text>
            </View>
            {!preview && !supported ? (
              <Text style={styles.errorText}>
                Multi-child online payment is not connected yet. Your fees have
                not been paid.
              </Text>
            ) : null}
            <Button
              disabled={
                busy ||
                (!preview &&
                  (!supported || !enabledMethods.includes(method))) ||
                !selected.length
              }
              onPress={startCheckout}
            >
              {preview
                ? "Design preview — checkout unavailable"
                : `Continue to pay ${money(total)}`}
            </Button>
          </>
        ) : step === "pending" ? (
          <View style={styles.card}>
            <Text style={styles.panelTitle}>Awaiting verification</Text>
            <Text style={styles.subtitle}>
              Check the server-confirmed status. If a payment is uncertain,
              contact Finance using this reference.
            </Text>
            <Text selectable style={styles.bold}>
              {checkoutId}
            </Text>
            <Button disabled={busy} onPress={checkStatus}>
              Check payment status
            </Button>
          </View>
        ) : displayReceipt ? (
          <>
            <Hero receipt />
            <View style={styles.card}>
              <Text style={styles.panelTitle}>Combined payment receipt</Text>
              <Text style={styles.small}>
                {displayReceipt.id} ·{" "}
                {displayReceipt.period || "School fee payment"}
              </Text>
              <Row label="Total paid" value={money(displayReceipt.amount)} />
              <Row
                label="Payment method"
                value={displayReceipt.method || "Provider payment"}
              />
              <Row
                label="Status"
                value={preview ? "Design sample" : "Confirmed"}
                green
              />
              <View style={styles.divider} />
              <Text style={styles.bold}>Allocated to each child’s invoice</Text>
              {displayReceipt.allocations.map((allocation, index) => {
                const item = receiptItems.find(
                  (value) =>
                    value.childId === allocation.childId &&
                    value.id === allocation.invoiceId
                );
                return (
                  <View
                    style={styles.allocation}
                    key={`${allocation.childId}:${allocation.invoiceId}`}
                  >
                    <Avatar index={index} preview={preview} />
                    <View style={styles.flex}>
                      <Text style={styles.childName}>
                        {item?.childName || "Linked child"}
                      </Text>
                      <Text style={styles.small}>{item?.classLabel}</Text>
                      <Row label="Paid" value={money(allocation.amount)} />
                      <Row
                        label="Remaining balance"
                        value={money(allocation.remainingBalance)}
                        green
                      />
                    </View>
                  </View>
                );
              })}
              <Button onPress={() => download()}>
                Download combined receipt
              </Button>
              <Button secondary onPress={() => download(true)}>
                View individual receipts
              </Button>
            </View>
          </>
        ) : (
          <Text style={styles.subtitle}>No verified receipt is available.</Text>
        )}
      </ScrollView>
      {step === "fees" ? (
        <View style={styles.sticky}>
          <Row
            label={`${selected.length} invoices selected`}
            value={money(total)}
          />
          <Button
            disabled={!selected.length || loading || busy}
            onPress={() => {
              setError("");
              setStep("method");
            }}
          >
            Pay selected fees
          </Button>
        </View>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.cream },
  content: { padding: 20, gap: 14, paddingBottom: 26 },
  title: {
    fontSize: 27,
    fontWeight: "900",
    color: palette.navy,
    letterSpacing: -0.6,
  },
  subtitle: { fontSize: 14, color: palette.muted, lineHeight: 21 },
  card: {
    borderRadius: 23,
    padding: 16,
    gap: 9,
    backgroundColor: "#FFFEFA",
    borderWidth: 1,
    borderColor: palette.border,
  },
  selectedCard: { borderColor: "#F2D397" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 3,
  },
  rowLabel: { fontSize: 13, color: palette.navy, flex: 1 },
  rowValue: {
    fontSize: 13,
    color: palette.navy,
    flexShrink: 1,
    textAlign: "right",
  },
  amountRow: { backgroundColor: palette.yellow, padding: 10, borderRadius: 10 },
  bold: { fontSize: 13, fontWeight: "800", color: palette.navy },
  green: { color: "#356D31" },
  small: { fontSize: 12, color: palette.muted, lineHeight: 18 },
  flex: { flex: 1 },
  childHeader: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    minHeight: 64,
  },
  childName: { color: palette.navy, fontSize: 16, fontWeight: "800" },
  avatar: {
    height: 46,
    width: 46,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 30 },
  checkbox: { fontSize: 29, color: palette.indigo },
  selectAll: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
    backgroundColor: palette.mint,
    padding: 13,
    borderRadius: 12,
    minHeight: 48,
  },
  button: {
    minHeight: 48,
    padding: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.indigo,
    borderRadius: 13,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center",
  },
  secondary: {
    backgroundColor: "#FFFEFA",
    borderWidth: 1,
    borderColor: palette.indigo,
  },
  secondaryText: { color: palette.indigo },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
  sticky: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.yellow,
    gap: 8,
  },
  periods: { gap: 8 },
  period: {
    minHeight: 44,
    padding: 12,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 13,
    backgroundColor: "#FFFEFA",
  },
  periodActive: { backgroundColor: palette.lavender, borderColor: "#CBC8FC" },
  periodText: { color: palette.navy, fontSize: 13 },
  divider: {
    borderTopWidth: 1,
    borderColor: palette.border,
    marginVertical: 5,
  },
  panelTitle: { color: palette.navy, fontSize: 17, fontWeight: "800" },
  breakdown: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
  },
  method: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    padding: 13,
    minHeight: 74,
    borderRadius: 14,
  },
  methodActive: { backgroundColor: palette.lavender },
  radio: { fontSize: 26, color: palette.indigo },
  methodIcon: {
    fontSize: 24,
    fontWeight: "900",
    color: palette.indigo,
    width: 32,
  },
  secure: { padding: 13, borderRadius: 13, backgroundColor: palette.mint },
  secureText: { fontSize: 12, lineHeight: 19, color: "#526D4D" },
  error: { padding: 13, borderRadius: 13, backgroundColor: "#FFF0EA" },
  errorText: { fontSize: 13, lineHeight: 20, color: "#A44335" },
  back: { color: palette.indigo, fontWeight: "700", paddingVertical: 7 },
  preview: { fontSize: 10, letterSpacing: 0.8, color: "#9B742F" },
  hero: {
    minHeight: 126,
    justifyContent: "center",
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: palette.yellow,
  },
  heroImage: { borderRadius: 20, opacity: 0.7 },
  heroCopy: {
    width: "54%",
    padding: 16,
    backgroundColor: "rgba(255,240,201,0.94)",
  },
  eyebrow: {
    fontSize: 9,
    letterSpacing: 1.3,
    fontWeight: "800",
    color: "#9B742F",
  },
  heroTitle: {
    marginTop: 8,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: "800",
    color: palette.navy,
  },
  allocation: {
    flexDirection: "row",
    gap: 10,
    padding: 13,
    backgroundColor: "#EDF6E4",
    borderRadius: 13,
  },
});
