export type BillingProfileItem = {
  name: string;
  /** Shown as historical context; only stable prices are copied into the editor. */
  referencePrice?: number;
  price?: string;
  quantity?: string;
  note: string;
};

export type BillingProfile = {
  id: string;
  label: string;
  items: BillingProfileItem[];
};

const dfl: BillingProfileItem = {
  name: "DFL / CA / IA / W / Supplies",
  referencePrice: 60,
  price: "60.00",
  note: "Common $60 unit price. Set the quantity for this job; other DFL variants remain separate items."
};

export const BILLING_PROFILES: BillingProfile[] = [
  {
    id: "receiver",
    label: "Receiver",
    items: [
      dfl,
      { name: "Capacitor Kit / Shipping", referencePrice: 84.88, quantity: "1", note: "Historical median; confirm the kit price." }
    ]
  },
  {
    id: "turntable",
    label: "Turntable",
    items: [
      dfl,
      { name: "Belt", referencePrice: 28.95, quantity: "1", note: "Historical median from four priced bills; confirm the belt price." },
      { name: "Cartridge", referencePrice: 169.45, quantity: "1", note: "Prices vary by cartridge; confirm the actual price." },
      { name: "Audio Cable", referencePrice: 26.99, price: "26.99", quantity: "1", note: "Usual price and quantity in the reviewed bills." }
    ]
  },
  {
    id: "wave-radio",
    label: "Wave Radio / Music System",
    items: [
      { name: "Capacitor Kit / Shipping", referencePrice: 79.5, quantity: "1", note: "Historical median; confirm the kit price." },
      { ...dfl, quantity: "0.3", note: "Often $60 × 0.3 for this equipment; adjust for the work done." },
      { name: "Screw Joint Modification", referencePrice: 30, price: "30.00", quantity: "1", note: "Consistent in 11 reviewed Wave Radio bills." },
      { name: "Heatsink / Shipping", referencePrice: 30, price: "30.00", quantity: "1", note: "$30 in 9 of 10 priced examples; confirm if used." }
    ]
  },
  {
    id: "amplifier",
    label: "Amplifier / Preamp",
    items: [
      dfl,
      { name: "Capacitor Kit / Shipping", referencePrice: 67.4, quantity: "1", note: "Historical median; confirm the kit price." }
    ]
  },
  {
    id: "cd-player",
    label: "CD Player / Changer",
    items: [
      { ...dfl, quantity: "0.3", note: "Often about $60 × 0.3; adjust for the work done." },
      { name: "Belt Kit / Shipping", referencePrice: 27.45, quantity: "1", note: "Historical median; confirm the kit price." },
      { name: "Capacitor Kit / Shipping", referencePrice: 72.83, quantity: "1", note: "Historical median; confirm the kit price." }
    ]
  },
  {
    id: "cassette-deck",
    label: "Cassette Deck",
    items: [
      dfl,
      { name: "Belt Kit / Shipping", referencePrice: 45, quantity: "1", note: "Historical median; confirm the kit price." }
    ]
  },
  {
    id: "speaker",
    label: "Speaker",
    items: [
      dfl,
      { name: "Speaker Kit Replacement", quantity: "1", note: "Part and price depend on the speaker; enter the actual price." }
    ]
  },
  {
    id: "woofer",
    label: "Woofer / Subwoofer",
    items: [
      dfl,
      { name: "Speaker Rebuilt", quantity: "1", note: "A past example was $260; confirm the actual rebuild price." },
      { name: "Sub Plate Assembly", quantity: "1", note: "A past example was $350; confirm the actual assembly price." },
      { name: "Parts Kit / Shipping", quantity: "1", note: "A past example was $49; confirm the actual kit price." }
    ]
  }
];

/** Match the portal's inconsistent equipment labels without treating a subwoofer as a speaker. */
export function billingProfileForEquipment(name: string | null | undefined): BillingProfile | undefined {
  const value = (name ?? "").toLowerCase();
  const id = /sub\s*-?\s*woofer|woofer/.test(value) ? "woofer"
    : /speaker/.test(value) ? "speaker"
    : /wave radio|wave music system/.test(value) && !/shortwave/.test(value) ? "wave-radio"
    : /turntable|record player|phonograph/.test(value) ? "turntable"
    : /\bcd\b|compact disc/.test(value) && !/lcd/.test(value) ? "cd-player"
    : /cassette deck|cassette player|tape deck/.test(value) ? "cassette-deck"
    : /receiver/.test(value) ? "receiver"
    : /amplifier|preamp|pre-amplifier|power amp/.test(value) ? "amplifier"
    : "";
  return BILLING_PROFILES.find((profile) => profile.id === id);
}
