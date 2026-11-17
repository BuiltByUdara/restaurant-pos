export interface ReceiptPrinter {
  print(): Promise<void>;
}
export const browserReceiptPrinter: ReceiptPrinter = {
  async print() {
    window.print();
  },
};
