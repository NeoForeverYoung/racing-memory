export type ProductProfile = "sim" | "full";

declare const __LAPWING_PRODUCT_PROFILE__: ProductProfile;

export const productProfile: ProductProfile =
  typeof __LAPWING_PRODUCT_PROFILE__ === "undefined" ? "sim" : __LAPWING_PRODUCT_PROFILE__;
export const hardwareFeaturesEnabled = productProfile === "full";
