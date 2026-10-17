/* Default content. The site shows this until Supabase is connected, and
   anything not yet changed in the portal falls back to it. Text in
   [square brackets] is a placeholder: the site highlights it in yellow so
   it is easy to spot and replace (Portal -> Settings, or here). */
window.KANAM_DEFAULTS = {
  settings: {
    company: 'Kanam Logistics Limited',
    tagline: 'Sourcing, moving and delivering for Western Kenya: institutional supplies, Pishori rice and rural road works.',
    phone: '[Phone number, e.g. 0712 345 678]',
    whatsapp: '[WhatsApp number in full, e.g. 254712345678]',
    email: '[Email address]',
    location: '[Office location, e.g. Kisumu]',
    postal: '[P.O. Box]',
    hours: '[Opening hours, e.g. Mon–Sat, 8am–6pm]',
    year_registered: '[Year registered]',
    reg_no: '[Company registration number]',
    kra_pin: '[KRA PIN]',
    directors: '[Director names]',
    delivery_areas: '[Delivery areas, e.g. Kisumu, Siaya, Homa Bay and Migori]',
    payment: '[Payment options, e.g. M-Pesa or cash on delivery]',
    about: 'Kanam Logistics Limited is a Kenyan company that gets goods and work to where they are needed. We began by maintaining rural roads under contract with the Kenya Rural Roads Authority (KERRA) and supplying foodstuff to Jaramogi Oginga Odinga Teaching & Referral Hospital (JOOTRH). Today we also trade Pishori rice, sourced at the farm gate and delivered sorted and packed.',
    mission: 'To be the supplier institutions and families can count on: the right goods, at a fair price, delivered on time.',
    roads_done: '[No. of roads / contracts]',
    years_supplying: '[Years supplying institutions]'
  },

  products: [
    { id: 'rice-5', name: 'Pishori rice', size_kg: 5, price: 750, in_stock: true, description: 'Aromatic Pishori rice, sorted and packed.' },
    { id: 'rice-10', name: 'Pishori rice', size_kg: 10, price: 1500, in_stock: true, description: 'Aromatic Pishori rice, sorted and packed.' },
    { id: 'rice-25', name: 'Pishori rice', size_kg: 25, price: 3700, in_stock: true, description: 'Aromatic Pishori rice, sorted and packed. Best value for families and shops.' }
  ],

  // Shown on Contact. Testimonials and team stay hidden until real ones are added in the portal.
  faqs: [
    { id: 'f1', topic: 'Rice', question: 'How do I order rice?', answer: 'Use the order form on the Pishori Rice page, call us, or send a WhatsApp message with the bag size and how many bags you need. We call back to confirm the price, place and time.' },
    { id: 'f2', topic: 'Rice', question: 'Where do you deliver?', answer: 'We deliver across [Delivery areas]. Ask us about other places.' },
    { id: 'f3', topic: 'Rice', question: 'How do I pay?', answer: '[Payment options, e.g. M-Pesa on delivery or bank transfer for institutions]' },
    { id: 'f4', topic: 'Supplies', question: 'Do you supply institutions on LPO / LSO?', answer: 'Yes. Send us your requirements and we will quote, then deliver on the schedule you set, with delivery notes and invoices.' },
    { id: 'f5', topic: 'General', question: 'Can you share company documents for a tender?', answer: 'Yes. Ask us for the certificate of incorporation, KRA PIN and tax compliance certificate and our company profile.' }
  ],
  testimonials: [],
  team: [],

  projects: [
    { id: 'p1', title: '[Road name] maintenance', category: 'Road works', client: 'KERRA', location: '[County]', year: '[Year]',
      description: '[What was done, e.g. grading, murram gravelling and culvert cleaning over 5 km.]' },
    { id: 'p2', title: 'Foodstuff supply to JOOTRH', category: 'Supplies & delivery', client: 'JOOTRH', location: 'Kisumu', year: '[Year]',
      description: '[What was supplied and how often, e.g. weekly deliveries of cereals and vegetables.]' },
    { id: 'p3', title: 'Pishori rice, Batch 1', category: 'Rice trading', client: 'Retail & wholesale', location: 'Sirare → Kisumu', year: '2026',
      description: '2,500 kg of Pishori rice sourced in Sirare, sorted and packed into 5, 10 and 25 kg bags, and delivered to Kisumu.' }
  ]
};
