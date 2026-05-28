export type { AuthUser, Role } from "@abaya-shop/shared";

export interface CartItem {
  productId: string;
  name: string;
  qty: number;
  unitFils: number;
  discountFils: number;
  totalFils: number;
}
