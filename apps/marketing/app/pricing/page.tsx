import SiteHeader from "../_components/SiteHeader";
import SiteFooter from "../_components/SiteFooter";
import PricingSheet from "./pricing-sheet";

export default function PricingPage() {
  return (
    <div className="page">
      <SiteHeader />
      <PricingSheet mode="web" />

      <SiteFooter />
    </div>
  );
}
