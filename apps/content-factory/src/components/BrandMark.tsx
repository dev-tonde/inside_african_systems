import {brand} from "../brand";

export const BrandMark = ({inverse = false}: {inverse?: boolean}) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 16,
      fontSize: 24,
      fontWeight: 800,
      letterSpacing: 2.5,
    }}
  >
    <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
      <circle cx="22" cy="22" r="19" fill="none" stroke={brand.colors.ember} strokeWidth="4" />
      <path d="M9 25h9l4-11 4 18 4-9h6" fill="none" stroke={inverse ? brand.colors.paper : brand.colors.ink} strokeWidth="3.5" />
    </svg>
    <span>INSIDE AFRICAN SYSTEMS</span>
  </div>
);
