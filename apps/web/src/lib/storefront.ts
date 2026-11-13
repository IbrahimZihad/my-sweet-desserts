import type { CakeDto } from "@cakeflow/contracts";

export interface Storefront {
  id: string;
  slug: string;
  name: string;
  legalName?: string | null;
  email?: string;
  logoUrl: string | null;
  brandColor: string;
  heroImageUrl: string | null;
  about: string | null;
  currency: string;
  timezone: string;
  depositType: "FLAT" | "PERCENTAGE";
  depositValue: number;
  depositRefundable: boolean;
  refundWindowHours: number;
  leadTimeHours: number;
  maxAdvanceDays: number;
  addressLine: string | null;
  suburb: string | null;
  postcode: string | null;
  phone: string | null;
  cakes: CakeDto[];
}
