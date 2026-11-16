// Practical kit for a cleaner or a cleaning agency.
// Drawn from supplier checklists (phs, BigClean, commercial janitorial guides):
// daily tools, products, safety gear, and items that get used up.

export const CLEANING_KIT = [
  {
    id: 'tools',
    title: 'Everyday tools',
    intro: 'These cover most homes and small offices.',
    items: [
      {
        name: 'Vacuum cleaner',
        detail:
          'Lifts dust from carpets, rugs, and hard floors. A filter that traps fine dust is worth it in homes and offices.',
      },
      {
        name: 'Mop and bucket with a wringer',
        detail:
          'Washes tile, vinyl, and laminate. The wringer keeps the floor from staying soaked.',
      },
      {
        name: 'Colour-coded microfibre cloths',
        detail:
          'Use one colour for the kitchen, one for the bathroom, one for general surfaces, and one for glass, so dirt is not carried between rooms.',
      },
      {
        name: 'Broom and dustpan',
        detail: 'Sweeps loose dirt, including corners a vacuum misses, before you mop.',
      },
      {
        name: 'Scrub brush',
        detail: 'Works on grout, skirting boards, and marks a cloth will not shift.',
      },
      {
        name: 'Squeegee',
        detail: 'Clears water from glass, mirrors, and wet floors without streaks.',
      },
      {
        name: 'Cleaning caddy or trolley',
        detail: 'Carries bottles, cloths, and bags from room to room.',
      },
      {
        name: 'Labelled spray bottles',
        detail: 'Hold diluted cleaner. A label on every bottle stops the wrong product being used.',
      },
      {
        name: 'High-level duster',
        detail: 'Reaches cobwebs, vents, and the tops of cupboards.',
      },
    ],
  },
  {
    id: 'machines',
    title: 'Machines for larger sites',
    intro: 'A solo cleaner can start without these. An agency taking offices and corridors will want them.',
    items: [
      {
        name: 'Steam cleaner',
        detail: 'Hot steam loosens grease and stains on tiles, cookers, and upholstery.',
      },
      {
        name: 'Floor buffer',
        detail: 'Puts a shine on hard floors in corridors and receptions.',
      },
      {
        name: 'Backpack vacuum',
        detail: 'Lets a cleaner move quickly through stairs and a large office.',
      },
    ],
  },
  {
    id: 'products',
    title: 'Cleaning products',
    intro: 'Match the product to the surface. Read the label before you dilute it.',
    items: [
      {
        name: 'Multi-surface cleaner',
        detail: 'The everyday cleaner for desks, doors, and most indoor surfaces.',
      },
      {
        name: 'Disinfectant',
        detail: 'For handles, switches, and other places people touch often.',
      },
      {
        name: 'Bathroom cleaner',
        detail: 'Cuts soap scum and limescale on sinks, showers, and tiles.',
      },
      {
        name: 'Toilet cleaner',
        detail: 'Stays on the bowl long enough to clean it. Keep it off other surfaces.',
      },
      {
        name: 'Glass cleaner',
        detail: 'For windows and mirrors.',
      },
      {
        name: 'Degreaser',
        detail: 'For kitchen hobs, splashbacks, and greasy floors.',
      },
      {
        name: 'Floor cleaner for that floor',
        detail: 'Match the product to wood, tile, or vinyl so the finish is not damaged.',
      },
    ],
  },
  {
    id: 'safety',
    title: 'Safety gear',
    intro: 'This protects the person doing the work. Employers should provide it for their staff.',
    items: [
      {
        name: 'Nitrile gloves',
        detail: 'For day-to-day cleaning and for handling products.',
      },
      {
        name: 'Chemical-resistant gloves',
        detail: 'When the label says the liquid is stronger than a normal spray.',
      },
      {
        name: 'Safety glasses',
        detail: 'When you dilute or spray a product that can splash.',
      },
      {
        name: 'Mask',
        detail: 'When the job is dusty, or the product label says to cover your nose and mouth.',
      },
      {
        name: 'Non-slip shoes',
        detail: 'Floors are wet while you mop. Closed shoes with a grip reduce falls.',
      },
      {
        name: 'Apron',
        detail: 'Keeps clothes dry during wet work.',
      },
      {
        name: 'Wet floor sign',
        detail: 'Put it out before the floor is wet, and leave it until the floor is dry.',
      },
      {
        name: 'Spill kit',
        detail: 'Absorbent material, gloves, and bags for a chemical spill.',
      },
      {
        name: 'First aid kit',
        detail: 'For cuts and splashes on the job.',
      },
    ],
  },
  {
    id: 'supplies',
    title: 'Items you replace',
    intro: 'Buy these again as they run out. A worn mop or a full vacuum bag stops a job.',
    items: [
      {
        name: 'Bin liners',
        detail: 'In the sizes the sites you clean actually use.',
      },
      {
        name: 'Spare mop heads and cloths',
        detail: 'Replace them when they stay dirty after washing.',
      },
      {
        name: 'Paper roll',
        detail: 'For spills, glass, and wiping up before a disinfectant.',
      },
      {
        name: 'Washroom restock',
        detail: 'Hand soap and paper towels, when the job includes keeping the washroom stocked.',
      },
    ],
  },
];
