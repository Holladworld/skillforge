import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { loadPaystackScript, initializePaystack, generateReference, PAYSTACK_PUBLIC_KEY, PRICING } from "@/services/paystack";
import { createPayment, updatePaymentStatus } from "@/lib/firestore";
import { toast } from "sonner";
import { Loader2, CheckCircle, CreditCard, X } from "lucide-react";

interface CheckoutProps {
  paymentType: "one_on_one" | "monthly";
  onClose: () => void;
  onSuccess: () => void;
}

export default function Checkout({ paymentType, onClose, onSuccess }: CheckoutProps) {
  const { user } = useAuth();
  const [processing, setProcessing] = useState(false);

  const pricing = paymentType === "one_on_one" ? PRICING.ONE_ON_ONE : PRICING.MONTHLY;

  const formatPrice = (kobo: number) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
    }).format(kobo / 100);
  };

  const handlePayment = async () => {
    if (!user) {
      toast.error("Please sign in to continue");
      return;
    }

    setProcessing(true);
    try {
      // Load Paystack script
      await loadPaystackScript();

      const reference = generateReference("SF");
      const email = user.email || `${user.name.toLowerCase().replace(/\s/g, "")}@skillforge.com`;

      // Create payment record in Firestore
      const paymentId = await createPayment({
        userId: user.id,
        userName: user.name,
        email,
        paymentType,
        amount: pricing.amount,
        currency: "NGN",
        reference,
        status: "pending",
      });

      // Initialize Paystack
      const handler = initializePaystack({
        email,
        amount: pricing.amount,
        currency: "NGN",
        label: pricing.label,
        reference,
        publicKey: PAYSTACK_PUBLIC_KEY,
        description: pricing.description,
        callback: async (result: any) => {
          if (result.status === "success") {
            try {
              // Update payment status in Firestore
              await updatePaymentStatus(paymentId, "completed", result);
              toast.success("Payment successful! Welcome to SkillForge!");
              onSuccess();
            } catch (error) {
              console.error("Error updating payment:", error);
              toast.error("Payment succeeded but failed to update records. Please contact support.");
            }
          } else if (result.status === "cancelled") {
            await updatePaymentStatus(paymentId, "cancelled", result);
            toast.info("Payment cancelled");
          } else {
            await updatePaymentStatus(paymentId, "failed", result);
            toast.error("Payment failed. Please try again.");
          }
          setProcessing(false);
        },
        onClose: () => {
          setProcessing(false);
          toast.info("Payment window closed");
        },
      });

      handler.openIframe();
    } catch (error: any) {
      console.error("Payment error:", error);
      toast.error(error.message || "Failed to initialize payment. Please try again.");
      setProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-3xl border border-border shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center">
              <CreditCard className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h3 className="font-bold text-foreground">Checkout</h3>
              <p className="text-xs text-muted-foreground">{pricing.label}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={processing}
            className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-1">Total Amount</p>
            <p className="text-4xl font-extrabold text-foreground">{formatPrice(pricing.amount)}</p>
            <p className="text-xs text-muted-foreground mt-2">
              {pricing.description}
            </p>
          </div>

          <div className="bg-muted/50 rounded-xl p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Item</span>
              <span className="text-foreground font-medium">{pricing.label}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Payment method</span>
              <span className="text-foreground font-medium">Paystack</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Currency</span>
              <span className="text-foreground font-medium">NGN</span>
            </div>
          </div>

          <button
            onClick={handlePayment}
            disabled={processing}
            className="w-full py-3.5 rounded-xl gradient-primary text-primary-foreground font-semibold hover:opacity-90 transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {processing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <CreditCard className="w-5 h-5" />
                Pay {formatPrice(pricing.amount)}
              </>
            )}
          </button>

          <p className="text-xs text-muted-foreground text-center">
            By completing this payment, you agree to our terms of service.
            Your payment is secure and encrypted.
          </p>
        </div>
      </div>
    </div>
  );
}