import type { ReactNode } from "react";

type InvoiceTemplateCardProps = {
  name: string;
  description: string;
  previewImage: ReactNode;
  isSelected: boolean;
  selectedLabel: string;
  onSelect: () => void;
};

export default function InvoiceTemplateCard({
  name,
  description,
  previewImage,
  isSelected,
  selectedLabel,
  onSelect,
}: InvoiceTemplateCardProps) {
  return (
    <button
      type="button"
      className={`invoice-template-card${isSelected ? " selected" : ""}`}
      onClick={onSelect}
      aria-pressed={isSelected}
    >
      <div className="invoice-template-card__preview">{previewImage}</div>
      <div className="invoice-template-card__copy">
        <div className="invoice-template-card__title-row">
          <strong>{name}</strong>
          {isSelected ? <span className="badge">{selectedLabel}</span> : null}
        </div>
        <p>{description}</p>
      </div>
    </button>
  );
}
