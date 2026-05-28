import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ReceiptModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ReceiptModal({ open, onOpenChange }: ReceiptModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Receipt</DialogTitle>
          <DialogDescription>Receipt preview will use @react-pdf/renderer in Phase 2.</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}
