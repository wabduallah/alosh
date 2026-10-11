import { Lockup } from "@/components/brand";

/**
 * Brand lockup: the chick in its nest, beside the wordmark «العش».
 * Kept for older imports; new code uses Lockup and Mark from "@/components/brand".
 */
export function Logo({ size = "lg" }: { size?: "md" | "lg" }) {
  return <Lockup height={size === "lg" ? 72 : 34} />;
}
