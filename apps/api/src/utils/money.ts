/** All amounts in fils (integer). 1 AED = 100 fils. */

export const toFils = (aed: number): number => Math.round(aed * 100);

export const toAED = (fils: number): number => fils / 100;

export const formatAED = (fils: number): string =>
  (fils / 100).toLocaleString("en-AE", {
    style: "currency",
    currency: "AED",
    minimumFractionDigits: 2,
  });

export const calcVAT = (subtotalFils: number, discountFils = 0): number =>
  Math.round((subtotalFils - discountFils) * 0.05);
