import PricingPdfActions from "../pricing-pdf-actions";
import PricingSheet from "../pricing-sheet";

export default function PricingPdfPage() {
  return (
    <div className="page pricing-pdf-page">
      <div className="container">
        <PricingPdfActions />
      </div>
      <PricingSheet mode="pdf" />
    </div>
  );
}
