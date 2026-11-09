/* ===================== The 29 World — Base template =====================
   A ready-made, balanced class setup a teacher can pick instead of
   starting from scratch. Everything in it is scaled for a school TERM
   (about 10 weeks) up to a school YEAR (about 40 weeks): small dollar
   amounts, short mortgage / loan / deposit terms, and weekly rates that
   show their effect quickly.

   The rough economy, so the numbers below make sense together:
     - Starting money ......... $100
     - Weekly wage (gross) .... about $80 (first job) up to $165 (top tier)
     - Weekly take-home ....... about $75 to $145 after tax
     - Typical weekly costs ... transport ~$20 (a bike or car cuts it) + insurance
                                ~$5-10 + a mortgage or rent of $30-60 + a few random
                                events
     - So in one term a student can build savings, buy a few things, a bike
       or a cheap car, and try a loan or term deposit. Over a year they can
       realistically work toward a mortgage on a modest home.

   TERM OPTIONS: the numbers below are the 1-term version. A teacher can
   also pick 2 or 4 terms (T29_BASE_TEMPLATE_TERM_OPTIONS). Weekly money
   (wages, rent, bills, side hustles) stays the same, so a
   week always feels the same. What scales is the big stuff: one-off prices,
   balances, limits and big events go x1 / x2 / x4, and time-based things (mortgage and
   loan lengths, promotions, KiwiSaver wait) go x1 / x1.5 / x2. Weekly random events happen
   several times a week, so they scale gently with the time factor (x1 / x1.5 / x2).
   See t29BaseTemplateScale and t29BaseTemplateData.

   Loaded after the data-*.js files, because it reuses their helpers (the
   same cleaners the teacher's own forms use), so everything here has the
   exact shape the rest of the app expects. Nothing in this file touches
   students, balances or history — a base-template class starts empty.
====================================================================== */

const T29_BASE_TEMPLATE_LABEL = "Balanced school-term starter";

/* ---------------- The content ---------------- */
// Starting money each student gets (1-term version; scaled for 2 and 4 terms).
const BT_WELCOME_GRANT = 100;

// Jobs: every default job is a daily Questionnaire job. Each has 3 pay tiers (weekly gross wage) and a pool of
// questions about the job's subject. Students answer 3 of the 8 each school day (Mon-Fri) to earn their wage.
// autoPromoteWeeks = weeks in a tier before moving up automatically.
// qs: [question, [options], index of the correct option]
const BT_JOBS = [
  { title: "Mathematician", promote: 4, tiers: [
    ["Number Cruncher", 80, "Solves daily maths puzzles and checks the class's sums."],
    ["Mathematician", 105, "Works through algebra, geometry and statistics problems."],
    ["Head Mathematician", 135, "Sets the hardest problems and explains the answers."] ],
    qs: [
    ["What is 12 × 8?", ["86", "96", "88", "108"], 1],
    ["What is 25% of 240?", ["50", "60", "80", "120"], 1],
    ["Solve: 3x + 5 = 20. What is x?", ["3", "5", "15", "25"], 1],
    ["What is the area of a rectangle that is 7 m by 6 m?", ["13 m²", "26 m²", "42 m²", "49 m²"], 2],
    ["Which of these is a prime number?", ["21", "27", "29", "33"], 2],
    ["What is the mean of 4, 8, 10 and 18?", ["8", "10", "12", "40"], 1],
    ["The angles in a triangle add up to how many degrees?", ["90", "180", "270", "360"], 1],
    ["What is 3/4 as a decimal?", ["0.34", "0.5", "0.75", "0.8"], 2] ] },
  { title: "Scientist", promote: 4, tiers: [
    ["Lab Assistant", 82, "Helps with experiments and records the results."],
    ["Scientist", 107, "Plans fair tests and explains what the results show."],
    ["Lead Scientist", 138, "Leads the research team and checks the conclusions."] ],
    qs: [
    ["Which gas do plants take in for photosynthesis?", ["Oxygen", "Nitrogen", "Carbon dioxide", "Hydrogen"], 2],
    ["What is the chemical formula for water?", ["CO2", "H2O", "O2", "NaCl"], 1],
    ["Which planet is closest to the Sun?", ["Venus", "Earth", "Mars", "Mercury"], 3],
    ["What is the SI unit of force?", ["Joule", "Watt", "Newton", "Volt"], 2],
    ["Which part of a cell contains its DNA?", ["Nucleus", "Cell wall", "Vacuole", "Cell membrane"], 0],
    ["At sea level, water boils at what temperature?", ["50 °C", "90 °C", "100 °C", "120 °C"], 2],
    ["Which of these animals is a mammal?", ["Shark", "Lizard", "Eel", "Dolphin"], 3],
    ["Which force pulls objects towards the Earth?", ["Friction", "Magnetism", "Gravity", "Tension"], 2] ] },
  { title: "Historian", promote: 4, tiers: [
    ["Archive Helper", 85, "Looks up facts and dates for the class timeline."],
    ["Historian", 110, "Researches events and explains why they mattered."],
    ["Chief Historian", 142, "Leads the research and decides what goes in the record."] ],
    qs: [
    ["In what year was the Treaty of Waitangi first signed?", ["1769", "1840", "1893", "1907"], 1],
    ["Who charted the New Zealand coastline in 1769?", ["Abel Tasman", "Edmund Hillary", "James Cook", "Ernest Rutherford"], 2],
    ["In 1893, New Zealand became the first self-governing country to let women do what?", ["Drive cars", "Vote in national elections", "Join the army", "Own land"], 1],
    ["Who were the first people to settle Aotearoa New Zealand?", ["Dutch explorers", "British settlers", "Vikings", "Polynesian ancestors of Māori"], 3],
    ["In what year did the Second World War end?", ["1918", "1939", "1945", "1950"], 2],
    ["Which ancient Egyptian structures were built as tombs for pharaohs?", ["Pyramids", "Colosseum", "Parthenon", "Great Wall"], 0],
    ["Anzac Day, on 25 April, remembers the landings at which place in 1915?", ["Normandy", "Crete", "Singapore", "Gallipoli"], 3],
    ["Which ancient civilisation built the Colosseum?", ["Greeks", "Romans", "Egyptians", "Aztecs"], 1] ] },
  { title: "Geographer", promote: 4, tiers: [
    ["Map Reader", 85, "Reads maps and finds places for the class."],
    ["Geographer", 110, "Studies landforms, climate and how people use the land."],
    ["Chief Cartographer", 140, "Draws the maps and leads the geography team."] ],
    qs: [
    ["What is the capital city of New Zealand?", ["Auckland", "Wellington", "Christchurch", "Dunedin"], 1],
    ["Which is the longest river in New Zealand?", ["Waikato", "Clutha", "Whanganui", "Waitaki"], 0],
    ["What is the highest mountain in New Zealand?", ["Mount Ruapehu", "Aoraki Mount Cook", "Mount Taranaki", "Mount Tasman"], 1],
    ["Which ocean lies between New Zealand and South America?", ["Atlantic", "Indian", "Arctic", "Pacific"], 3],
    ["Which is the largest continent?", ["Africa", "Asia", "Europe", "North America"], 1],
    ["What is the imaginary line at 0° latitude called?", ["Prime Meridian", "Tropic of Cancer", "Equator", "Date Line"], 2],
    ["What is the capital city of Australia?", ["Sydney", "Melbourne", "Perth", "Canberra"], 3],
    ["What do contour lines on a map show?", ["Roads", "Height of the land", "Rainfall", "Borders"], 1] ] },
  { title: "Author", promote: 5, tiers: [
    ["Story Starter", 88, "Writes short stories and checks spelling and punctuation."],
    ["Author", 115, "Writes longer pieces and uses language to create effect."],
    ["Head Editor", 148, "Edits other writers' work and polishes the final version."] ],
    qs: [
    ["Which of these words is a noun?", ["Run", "Quickly", "Table", "Beautiful"], 2],
    ["Which word is spelled correctly?", ["Definately", "Definitely", "Definitly", "Defanitely"], 1],
    ["A simile compares two things using which pair of words?", ["\"like\" or \"as\"", "\"but\" or \"so\"", "\"if\" or \"then\"", "\"and\" or \"or\""], 0],
    ["What is the past tense of \"swim\"?", ["Swimmed", "Swum", "Swimming", "Swam"], 3],
    ["What do we call the main character in a story?", ["Antagonist", "Protagonist", "Narrator", "Editor"], 1],
    ["Which word is a synonym for \"happy\"?", ["Gloomy", "Angry", "Joyful", "Tired"], 2],
    ["In \"Mia's bag\", what does the apostrophe show?", ["A plural", "A question", "Speech", "Possession"], 3],
    ["Which of these is a complete sentence?", ["Running down the road.", "Because it was late.", "After the game.", "The dog barked loudly."], 3] ] },
  { title: "Software Developer", promote: 6, tiers: [
    ["Junior Coder", 92, "Fixes small bugs and writes simple programs."],
    ["Software Developer", 122, "Builds features and tests them properly."],
    ["Tech Team Lead", 158, "Leads the team and reviews everyone's code."] ],
    qs: [
    ["What does HTML stand for?", ["HyperText Markup Language", "High Tech Modern Language", "Home Tool Markup Language", "HyperTransfer Machine Link"], 0],
    ["Which language is mainly used to style web pages?", ["SQL", "CSS", "Python", "C++"], 1],
    ["In programming, what is a loop used for?", ["Stopping the program", "Deleting files", "Repeating instructions", "Drawing a picture"], 2],
    ["What is a \"bug\" in a program?", ["A fast computer", "A keyboard shortcut", "A type of virus scanner", "An error in the code"], 3],
    ["What is the binary number 101 in decimal?", ["3", "5", "6", "10"], 1],
    ["Which of these is the strongest password?", ["password123", "12345678", "A long mix of random words, numbers and symbols", "Your birthday"], 2],
    ["What does CPU stand for?", ["Central Processing Unit", "Computer Personal Unit", "Central Program Utility", "Core Power Unit"], 0],
    ["What is a variable used for in code?", ["Printing on paper", "Storing a value", "Connecting to wifi", "Speeding up the screen"], 1] ] },
  { title: "Accountant", promote: 6, tiers: [
    ["Bookkeeper", 95, "Keeps track of money coming in and going out."],
    ["Accountant", 125, "Prepares budgets and works out tax and profit."],
    ["Chief Financial Officer", 165, "Plans how the whole class economy spends and saves."] ],
    qs: [
    ["Which of these is a need rather than a want?", ["Gaming console", "Rent", "Concert ticket", "Designer sneakers"], 1],
    ["You earn $500 and spend $350. How much did you save?", ["$100", "$150", "$200", "$850"], 1],
    ["What is interest?", ["A type of tax", "A bank holiday", "Money paid for borrowing, or earned from saving", "A kind of insurance"], 2],
    ["What does GST stand for in New Zealand?", ["General Savings Tax", "Goods and Services Tax", "Government Spending Total", "Gross Salary Tax"], 1],
    ["What is a budget?", ["A plan for how you will spend and save money", "A type of bank account", "A loan from a friend", "A shop receipt"], 0],
    ["An $80 jacket is 25% off. What is the sale price?", ["$20", "$55", "$60", "$65"], 2],
    ["What is KiwiSaver?", ["A bird sanctuary fund", "A student loan", "A voluntary retirement savings scheme", "A type of car insurance"], 2],
    ["What is \"net pay\"?", ["Pay before tax", "Pay after tax and deductions", "A yearly bonus", "Overtime pay"], 1] ] },
  { title: "Te Reo Māori Translator", promote: 5, tiers: [
    ["Kupu Helper", 88, "Learns and shares everyday Māori words and greetings."],
    ["Translator", 115, "Translates short phrases and labels around the room."],
    ["Head Translator", 150, "Leads te reo Māori in class and coaches the team."] ],
    qs: [
    ["What does \"Kia ora\" mean?", ["Goodbye", "Sorry", "Hello", "Good night"], 2],
    ["What number is \"rima\"?", ["3", "5", "7", "10"], 1],
    ["What does \"whānau\" mean?", ["Friend", "Teacher", "School", "Family"], 3],
    ["What does \"Haere mai\" mean?", ["Goodbye", "Thank you", "Welcome", "Good luck"], 2],
    ["What does \"whenua\" mean?", ["Water", "Land", "Sky", "Fire"], 1],
    ["\"Aotearoa\" is often translated as...", ["Land of the long white cloud", "Land of the rising sun", "Place of many birds", "The southern isles"], 0],
    ["What does \"kai\" mean?", ["Sleep", "Run", "Book", "Food"], 3],
    ["What is the Māori word for \"school\"?", ["Whare", "Waka", "Kura", "Marae"], 2] ] }
];
// Store: [name, price, stars (lifestyle), countsNetWorth, description, effect]
const BT_STORE = [
  ["Bubble Tea", 5, 0, false, "A cold drink after school.", "A small treat. No lasting effect."],
  ["Movie Night", 12, 0, false, "Tickets and popcorn with friends.", "A fun night out. No lasting effect."],
  ["Dinner Out", 20, 0, false, "A meal at a restaurant.", "A nice treat. No lasting effect."],
  ["Headphones", 30, 1, true, "Good quality headphones.", "Raises your lifestyle a little."],
  ["Trainers", 45, 1, true, "A solid pair of trainers.", "Raises your lifestyle a little."],
  ["Gaming Console", 85, 2, true, "A games console with a controller.", "Raises your lifestyle."],
  ["Smartphone", 110, 2, true, "A new smartphone.", "Raises your lifestyle."],
  ["Laptop", 150, 3, true, "A fast laptop for study and fun.", "Raises your lifestyle a lot."],
  ["Home Entertainment System", 200, 4, true, "A big screen and surround sound.", "Raises your lifestyle a lot."]
];

// Properties for sale: price, comfort (1-5), weeks to pay off a mortgage,
// weekly mortgage interest %, weekly rent if rented out, living-bonus stars,
// variable mortgage range [min,max] (weekly %), how many units to list.
const BT_PROPERTIES = [
  { name: "Studio Flat", price: 500, comfort: 1, weeks: 20, rate: 0.4, rent: 20, bonus: 1, vr: [0.2, 0.7], qty: 4,
    desc: "A tiny, affordable first home close to town." },
  { name: "Small Apartment", price: 900, comfort: 2, weeks: 26, rate: 0.5, rent: 34, bonus: 1, vr: [0.3, 0.8], qty: 4,
    desc: "One bedroom with a small balcony." },
  { name: "Townhouse", price: 1500, comfort: 3, weeks: 32, rate: 0.5, rent: 55, bonus: 2, vr: [0.3, 0.9], qty: 3,
    desc: "Two bedrooms and a little courtyard." },
  { name: "Family Home", price: 2400, comfort: 4, weeks: 40, rate: 0.6, rent: 85, bonus: 2, vr: [0.3, 1], qty: 2,
    desc: "Three bedrooms, a garden and a garage." },
  { name: "Luxury Villa", price: 4000, comfort: 5, weeks: 40, rate: 0.6, rent: 140, bonus: 3, vr: [0.4, 1.1], qty: 1,
    desc: "Four bedrooms, a pool and harbour views." }
];

// Places students can rent (the school landlord): weekly rent, minimum
// weeks, lifestyle points while living there, how many available.
const BT_RENTALS = [
  { name: "Shared Flat Room", rent: 30, min: 1, pts: 2, qty: 10, desc: "A room in a shared flat. Cheap and cheerful." },
  { name: "One-Bedroom Flat", rent: 40, min: 2, pts: 5, qty: 8, desc: "Your own small flat." },
  { name: "Two-Bedroom Unit", rent: 50, min: 2, pts: 8, qty: 6, desc: "Room to spread out, with a small yard." },
  { name: "Family House (Rental)", rent: 60, min: 3, pts: 12, qty: 4, desc: "A comfortable family house to rent." }
];

// Vehicles: type, price, comfort, weekly running cost, % off the public
// transport fee, pay per truck check-in.
const BT_VEHICLES = [
  { name: "Second-hand Bike", type: "bike", price: 40, comfort: 1, run: 0, off: 50, desc: "Cheap, healthy and free to run." },
  { name: "Electric Bike", type: "bike", price: 120, comfort: 2, run: 2, off: 70, desc: "Skip the sweat on the hills." },
  { name: "Used Hatchback", type: "car", price: 350, comfort: 2, run: 8, off: 80, desc: "Small, reliable and cheap to run." },
  { name: "Family Sedan", type: "car", price: 700, comfort: 3, run: 12, off: 90, desc: "Comfortable, with room for the family." },
  { name: "SUV", type: "car", price: 1200, comfort: 4, run: 18, off: 100, desc: "Roomy, powerful and a smooth ride." },
  { name: "Sports Car", type: "car", price: 2200, comfort: 5, run: 28, off: 100, desc: "Fast, flashy and expensive to run." },
  { name: "Delivery Truck", type: "truck", price: 1000, comfort: 2, run: 30, off: 0, pay: 25,
    desc: "Earns money each time you check in to drive it. Needs a truck licence." }
];

// Insurance. Property and transport plans sit under a company students open.
// [name, insType, weekly price, excess, lifestyle stars, signup fee, description]
const BT_INSURANCE_TRANSPORT = ["SafeDrive Insurance", [
  ["Comprehensive", "comprehensive", 4, 10, 2, 0, "Covers accidents, fire, theft, vandalism and storms for cars and bikes."],
  ["Fire & Theft", "tpft", 3, 12, 1, 0, "Covers fire, theft and damage to other people's property. Cars and bikes."],
  ["Third-Party Only", "third-party", 2, 15, 1, 0, "The cheapest cover: only damage you do to other people's property."],
  ["Truck Cover", "truck", 5, 15, 1, 0, "Covers anything that happens to your truck. Trucks only."]
]];
const BT_INSURANCE_PROPERTY = ["HomeGuard Insurance", [
  ["Contents Cover", "contents", 2, 5, 1, 0, "Covers the things inside your home, not the house itself."],
  ["Sum Insured Cover", "sum-insured", 4, 10, 2, 0, "Covers contents and the house up to a set amount. You keep your house."],
  ["Full Indemnity Cover", "indemnity", 5, 10, 2, 0, "Pays your house's full market price if it's written off, plus contents."]
]];
const BT_INSURANCE_OTHER = [
  { name: "Income Protection", coverage: "jobs", price: 3, excess: 10, stars: 1, signup: 0,
    desc: "Helps pay for job-related setbacks like injuries or retraining." },
  { name: "Health & Life Cover", coverage: "general", price: 2, excess: 4, stars: 1, signup: 0,
    desc: "Helps with everyday surprises like doctor and dentist bills." }
];

// Weekly random events: everyday things that really happen. Everyone gets 2-5 a week, so base
// amounts stay small (they are scaled up a little for 2 or 4 terms, see _btScaleEvent).
// amount: + you receive, - you pay.  bad: true = an insurable setback (claimable on general insurance,
// or on property / transport insurance when coverage + incident + cover are set).
// Setbacks nobody can insure (fines, fees, treats gone wrong) are left as plain negative amounts.
const BT_EVENTS = [
  // ---- good news ----
  { name: "Sold Your Old Textbooks", amount: 14, desc: "A younger student bought last year's textbooks off you." },
  { name: "Babysitting Gig", amount: 18, repeatable: true, desc: "A neighbour paid you to watch their kids for an evening." },
  { name: "Dog Returned Safely", amount: 10, desc: "You brought a lost dog home and the owner gave you a reward." },
  { name: "Garage Sale Success", amount: 16, repeatable: true, desc: "You sold some old things from your room at the weekend sale." },
  { name: "Cashback on Groceries", amount: 6, repeatable: true, desc: "Your bank paid you cashback on this week's grocery shop." },
  { name: "Friend Referral Reward", amount: 10, desc: "A friend signed up to a service you recommended and you both got a bonus." },
  { name: "Photo Competition Prize", amount: 20, desc: "Your photo placed third in a local competition." },
  { name: "Work Expenses Paid Back", amount: 12, repeatable: true, desc: "Your employer reimbursed you for supplies you bought for work." },
  { name: "Loyalty Card Full", amount: 5, repeatable: true, desc: "Your coffee stamp card filled up and earned store credit." },
  { name: "Petrol Money from a Mate", amount: 7, repeatable: true, desc: "A classmate chipped in after you gave them a lift to school." },
  { name: "Late Delivery Credit", amount: 6, repeatable: true, desc: "A courier company apologised for a late parcel with some credit." },
  { name: "Lost Property Reward", amount: 8, repeatable: true, desc: "You handed in a lost phone and the owner said thanks with some cash." },
  { name: "Lawn Mowing for Grandad", amount: 9, repeatable: true, desc: "Grandad slipped you some pocket money after you did his lawn." },
  { name: "Sold a Handmade Craft", amount: 13, repeatable: true, desc: "Someone bought one of your handmade bracelets at the school fair." },
  // ---- everyday costs (not insurable) ----
  { name: "Fare Evasion Fine", amount: -12, repeatable: true, desc: "You forgot to tag off the bus and got a small fine." },
  { name: "Free Trial Trap", amount: -9, repeatable: true, desc: "You forgot to cancel a free trial and it charged you." },
  { name: "School Trip Contribution", amount: -15, desc: "The class is going on a trip and everyone pays a share." },
  { name: "Late Phone Bill Fee", amount: -6, repeatable: true, desc: "You paid your phone bill a few days late." },
  { name: "Time for a Haircut", amount: -14, repeatable: true, desc: "Your hair needed a trim before the school photos." },
  { name: "Worn-Out School Shoes", amount: -24, desc: "Your old shoes finally fell apart and you needed a new pair." },
  { name: "Broken Bag Zip", amount: -8, repeatable: true, desc: "The zip on your school bag broke and you paid for a repair." },
  { name: "Phone Charger Died", amount: -7, repeatable: true, desc: "Your charger stopped working so you bought a new one." },
  { name: "Sports Team Fees", amount: -16, desc: "Your sports team needed the season registration paid." },
  { name: "Slept In, Took a Taxi", amount: -13, repeatable: true, desc: "You slept in and had to take a taxi to get to work on time." },
  { name: "Bank Card Replacement Fee", amount: -4, repeatable: true, desc: "Your bank charged a small fee to send you a new card." },
  // ---- health and belongings (claimable on general insurance) ----
  { name: "Sprained Ankle", amount: -18, bad: true, repeatable: true, desc: "You rolled your ankle at sport and needed strapping and a check-up." },
  { name: "Filling at the Dentist", amount: -22, bad: true, desc: "A toothache turned out to need a filling." },
  { name: "Prescription Medicine", amount: -8, bad: true, repeatable: true, desc: "The doctor prescribed medicine for a bad chest infection." },
  { name: "New Glasses", amount: -30, bad: true, desc: "Your eyesight changed and you needed a new pair of glasses." },
  { name: "Emergency Vet Visit", amount: -26, bad: true, desc: "Your pet ate something it shouldn't and needed treatment." },
  { name: "Stomach Bug Sick Day", amount: -14, bad: true, repeatable: true, desc: "You were too sick to work and needed a doctor's certificate." },
  { name: "Broken Headphones", amount: -12, bad: true, repeatable: true, desc: "You sat on your headphones and heard a loud crunch." },
  { name: "Allergic Reaction", amount: -15, bad: true, repeatable: true, desc: "A bad allergic reaction meant a trip to the after-hours clinic." },
  // ---- vehicle setbacks (only go to students who own a vehicle) ----
  { name: "Hailstorm Dents", amount: -35, bad: true, coverage: "transport", incident: ["storm"], repeatable: true,
    cover: [["comprehensive", 35], ["truck", 35]], desc: "A sudden hailstorm left dents all over your vehicle." },
  { name: "Chipped Windscreen", amount: -20, bad: true, coverage: "transport", incident: ["accident"], repeatable: true,
    cover: [["comprehensive", 20], ["truck", 20]], desc: "A stone flicked up on the motorway and chipped your windscreen." },
  { name: "Runaway Shopping Trolley", amount: -22, bad: true, coverage: "transport", incident: ["accident"], repeatable: true,
    cover: [["comprehensive", 22], ["truck", 22]], desc: "A runaway trolley rolled into your parked vehicle." },
  { name: "Vehicle Broken Into", amount: -28, bad: true, coverage: "transport", incident: ["theft"], repeatable: true,
    cover: [["comprehensive", 28], ["tpft", 28], ["truck", 28]], desc: "Someone smashed a window and took things from your vehicle." },
  { name: "Graffiti on Your Vehicle", amount: -25, bad: true, coverage: "transport", incident: ["vandalism"], repeatable: true,
    cover: [["comprehensive", 25], ["truck", 25]], desc: "Someone sprayed paint along the side of your vehicle overnight." },
  { name: "Reversed Into a Fence", amount: -30, bad: true, coverage: "transport", incident: ["accident", "third-party"], repeatable: true,
    cover: [["comprehensive", 30], ["tpft", 12], ["third-party", 12], ["truck", 30]], desc: "You backed out of a driveway and clipped a neighbour's fence." },
  // ---- home setbacks (only go to students with a home) ----
  { name: "Power Surge Fried the TV", amount: -35, bad: true, coverage: "property", incident: "contents",
    cover: [["contents", 35], ["sum-insured", 35], ["indemnity", 35]], desc: "A power surge during a storm destroyed your television." },
  { name: "Break-In While You Were Out", amount: -40, bad: true, coverage: "property", incident: "contents",
    cover: [["contents", 40], ["sum-insured", 40], ["indemnity", 40]], desc: "Someone broke in and took some of your belongings." },
  { name: "Fridge Gave Up", amount: -28, bad: true, coverage: "property", incident: "contents",
    cover: [["contents", 28], ["sum-insured", 28], ["indemnity", 28]], desc: "Your fridge broke down and all the food inside was ruined." },
  { name: "Storm Blew Down the Fence", amount: -22, bad: true, coverage: "property", incident: "house", repeatable: true,
    cover: [["sum-insured", 22]], desc: "A strong wind flattened part of your fence." },
  { name: "Smashed Window", amount: -26, bad: true, coverage: "property", incident: "house", repeatable: true,
    cover: [["sum-insured", 26]], desc: "A stray cricket ball smashed one of your windows." },
  // ---- choices ----
  { type: "choice", name: "Farewell Gift Collection", desc: "Your class is chipping in for a teacher's farewell gift. What will you do?",
    options: [["Chip in generously", -8, "The teacher was really touched."], ["Chip in a little", -3, "Every bit helped."], ["Skip it", 0, "You kept your money, but felt a little guilty."]] },
  { type: "choice", name: "Gym Sign-Up Offer", desc: "A gym is offering a month of membership for a sign-up fee.",
    options: [["Sign up", -20, "You felt fitter and more energetic."], ["Not this time", 0, "You saved your money and stayed on the couch."]] },
  { type: "choice", name: "Extended Warranty Pitch", desc: "The shop assistant tries to sell you an extended warranty on your new gadget.",
    options: [["Buy the warranty", -12, "Nothing broke, so it was not needed."], ["Say no thanks", 0, "You kept your money in your pocket."]] },
  { type: "choice", name: "Flash Sale on Trainers", desc: "A limited-time sale pops up on your favourite trainers.",
    options: [["Grab a pair", -25, "Great shoes, but they were a want, not a need."], ["Scroll past", 0, "You stuck to your budget."]] },
  { type: "choice", name: "Cousin Needs a Loan", desc: "Your cousin asks to borrow some money for the bus.",
    options: [["Lend it", -10, "They promised to pay you back soon."], ["Say no politely", 0, "They understood."]] },
  { type: "choice", name: "Group Dinner Bill", desc: "Your friends ordered a lot and want to split the bill evenly, but you only had a small meal.",
    options: [["Split it evenly", -18, "Fair is fair, but it stung a little."], ["Pay only for your meal", -10, "A bit awkward, but they agreed."]] },
  { type: "choice", name: "Coffee Habit", desc: "Your friends grab a coffee every morning before school.",
    options: [["Join them every day", -15, "Tasty, but it adds up quickly."], ["Make coffee at home", -3, "Cheap and just as good."]] },
  { type: "choice", name: "Weekend Moving Help", desc: "A neighbour offers to pay you for helping them move house.",
    options: [["Accept the job", 20, "Hard work, but you earned it."], ["Decline", 0, "You had a lazy weekend."]] },
  { type: "choice", name: "Op Shop Find", desc: "You spot a great jacket in the op shop window.",
    options: [["Buy it", -9, "A bargain you wear all the time."], ["Leave it", 0, "You walked out empty-handed."]] },
  { type: "choice", name: "Fun Run Fundraiser", desc: "Your school is holding a charity fun run.",
    options: [["Enter and fundraise", -10, "You finished the course and helped a good cause."], ["Sponsor a friend", -5, "Your friend was grateful."], ["Skip it", 0, "You cheered from the sidelines."]] },
  { type: "choice", name: "Takeaway Temptation", desc: "You are tired after work and your favourite takeaway shop is on the way home.",
    options: [["Order dinner out", -15, "Delicious, but pricey."], ["Cook at home", -4, "Healthy and cheap."]] }
];

// Big events: major life moments a teacher can launch for the class (losing a job, a home or a vehicle,
// and the good surprises too). cost: set dollars, or percent of the weekly wage for income events.
// takes = the student loses the job / property / vehicle if they can't pay and aren't insured.
// Costs and payouts are scaled by the term choice (x1 / x2 / x4).
const BT_BIG_EVENTS = [
  // ---- income ----
  { name: "Made Redundant", module: "income", kind: "bad", cost: 120, takes: true,
    desc: "Your company is cutting jobs and your role is on the list. Cover the costs of the change or lose your job." },
  { name: "Employer Goes Bust", module: "income", kind: "bad", cost: 130, takes: true,
    desc: "Your employer has gone out of business. Cover your costs while you find new work, or lose your job." },
  { name: "Licence Lapsed", module: "income", kind: "bad", cost: 60, takes: true,
    desc: "A certificate you need for work has run out. Pay for the renewal course or lose your job." },
  { name: "Serious Illness", module: "income", kind: "bad", cost: 100, takes: false,
    desc: "You were off work for weeks and your savings took a hit. Income Protection can help." },
  { name: "Workplace Accident", module: "income", kind: "bad", cost: 90, takes: false,
    desc: "You hurt yourself on the job and needed time off and treatment. Income Protection can help." },
  { name: "Burnout Recovery", module: "income", kind: "bad", cost: 70, takes: false,
    desc: "Too many long shifts left you worn out and you needed time to recover. Income Protection can help." },
  { name: "Promotion Bonus", module: "income", kind: "good", costMode: "percent", costPercent: 75,
    desc: "Your boss was so impressed that you were handed a bonus on top of your wage." },
  { name: "Profit Share Payout", module: "income", kind: "good", costMode: "percent", costPercent: 40,
    desc: "The business had a great quarter and shared some of the profit with staff." },
  { name: "Overtime Windfall", module: "income", kind: "good", costMode: "percent", costPercent: 30,
    desc: "A busy period meant plenty of extra paid shifts." },
  // ---- property ----
  { name: "House Fire", module: "property", kind: "bad", incident: "both", cost: 400, takes: true,
    cover: [["sum-insured", 400], ["indemnity", 60], ["contents", 60]],
    desc: "A fire has badly damaged your home and everything in it." },
  { name: "Flooded Home", module: "property", kind: "bad", incident: "both", cost: 300, takes: true,
    cover: [["sum-insured", 300], ["indemnity", 50], ["contents", 50]],
    desc: "Heavy rain flooded your home and ruined your belongings." },
  { name: "Earthquake Damage", module: "property", kind: "bad", incident: "house", cost: 350, takes: true,
    cover: [["sum-insured", 350], ["indemnity", 0]],
    desc: "A big earthquake cracked the foundations of your house." },
  { name: "Storm Rips Off the Roof", module: "property", kind: "bad", incident: "house", cost: 200, takes: false,
    cover: [["sum-insured", 200]], desc: "A fierce storm tore part of your roof away." },
  { name: "Fallen Tree on the House", module: "property", kind: "bad", incident: "house", cost: 220, takes: false,
    cover: [["sum-insured", 220]], desc: "A big tree came down on your house during a storm." },
  { name: "Burglary: Valuables Stolen", module: "property", kind: "bad", incident: "contents", cost: 150, takes: false,
    cover: [["contents", 150], ["sum-insured", 150], ["indemnity", 150]],
    desc: "Burglars cleared out your valuables while you were away." },
  { name: "Home Insulation Grant", module: "property", kind: "good", cost: 80,
    desc: "The government helped pay for insulating your home." },
  { name: "Council Rates Rebate", module: "property", kind: "good", cost: 30,
    desc: "The council refunds part of your yearly rates." },
  // ---- transport ----
  { name: "Major Crash", module: "transport", kind: "bad", incident: ["accident", "third-party"], cost: 220, takes: true,
    cover: [["comprehensive", 220], ["tpft", 80], ["third-party", 80], ["truck", 220]],
    desc: "You crashed your vehicle and damaged someone else's property too." },
  { name: "Vehicle Stolen", module: "transport", kind: "bad", incident: ["theft"], cost: 220, takes: true,
    cover: [["comprehensive", 220], ["tpft", 220], ["truck", 220]],
    desc: "Thieves stole your vehicle from outside your home." },
  { name: "Vehicle Fire", module: "transport", kind: "bad", incident: ["fire"], cost: 200, takes: true,
    cover: [["comprehensive", 200], ["tpft", 200], ["truck", 200]],
    desc: "An electrical fault set your vehicle on fire." },
  { name: "Flash Flood", module: "transport", kind: "bad", incident: ["storm"], cost: 160, takes: true,
    cover: [["comprehensive", 160], ["truck", 160]],
    desc: "A flash flood swept through the car park and ruined your vehicle." },
  { name: "Hit and Run", module: "transport", kind: "bad", incident: ["accident"], cost: 100, takes: false,
    cover: [["comprehensive", 100], ["truck", 100]],
    desc: "A driver hit your parked vehicle and drove off." },
  { name: "Slashed Tyres", module: "transport", kind: "bad", incident: ["vandalism"], cost: 80, takes: false,
    cover: [["comprehensive", 80], ["truck", 80]],
    desc: "Vandals slashed all four of your tyres overnight." },
  { name: "Fuel Voucher Win", module: "transport", kind: "good", cost: 25,
    desc: "You won a fuel voucher in a local prize draw." },
  { name: "Free Warrant of Fitness", module: "transport", kind: "good", cost: 20,
    desc: "A garage gave you a free safety check." },
  { name: "Road Charges Refund", module: "transport", kind: "good", cost: 40,
    desc: "You were refunded for road charges you overpaid." },
  // ---- general (open to everyone) ----
  { name: "Scholarship Award", module: "general", kind: "good", cost: 80, desc: "You won a scholarship for good grades." },
  { name: "Tax Refund", module: "general", kind: "good", cost: 35, desc: "You overpaid your tax and got some back." },
  { name: "Surprise Inheritance", module: "general", kind: "good", cost: 100, desc: "A distant relative left you a little money." },
  { name: "Competition Prize", module: "general", kind: "good", cost: 60, desc: "You won a big prize in a community competition." },
  { name: "Cost-of-Living Payment", module: "general", kind: "good", cost: 50, desc: "The government paid out a support grant to help with everyday costs." }
];

// Life events a teacher can give to students (benefits last while it is held).
const BT_LIFE = [
  { name: "Scholarship", desc: "Awarded for hard work at school.", b: { cashOnce: 50 } },
  { name: "Family Support Payment", desc: "A small weekly top-up from family.", b: { allowance: 5 } },
  { name: "Part-Time Study", desc: "Studying lifts your wages, and your future.", b: { incomePercent: 5, lifestylePoints: 2 } },
  { name: "Student Discount Card", desc: "Cheaper things at the store.", b: { discountStore: 10 } },
  { name: "Bus Pass Concession", desc: "Cheaper public transport.", b: { discountTransport: 25 } },
  { name: "First Home Support", desc: "A discount on buying property.", b: { discountProperty: 10 } },
  { name: "Safe Driver Rewards", desc: "A discount on insurance.", b: { discountInsurance: 15 } },
  { name: "Healthy Lifestyle", desc: "Sport and good food make life better.", b: { lifestylePoints: 3 } },
  { name: "Long-term Illness", desc: "A tough time that cuts your income.", b: { incomePercent: -10, lifestylePoints: -2 } }
];

// Side hustles: pay per daily check-in at each hour the student can choose.
const BT_HUSTLES = [
  { name: "Dog Walking", desc: "Walk the neighbours' dogs.", pay: { 6: 4, 7: 4, 15: 3, 16: 3, 17: 3, 18: 3, 19: 3 } },
  { name: "Lawn Mowing", desc: "Mow lawns around the street.", pay: { 8: 4, 9: 4, 10: 4, 15: 3, 16: 3, 17: 3 } },
  { name: "Paper Round", desc: "Deliver the local newspaper.", pay: { 6: 5, 7: 5, 16: 3, 17: 3 } },
  { name: "Baking Stall", desc: "Bake and sell treats at the weekend market.", pay: { 8: 4, 9: 4, 10: 4, 11: 4, 12: 4 } },
  { name: "Tutoring", desc: "Help younger students with homework.", pay: { 15: 5, 16: 5, 17: 5, 18: 5, 19: 5 } }
];

// Quizzes (practice and optional module locks). [question, [options], correct index, explanation]
const BT_QUIZZES = [
  { title: "Budgeting Basics", moduleKey: "budget", description: "Needs, wants and making a plan for your money.", questions: [
    ["Which of these is a NEED?", ["Video game subscription", "Food and a place to live", "Designer shoes", "Concert tickets"], 1, "Needs are things you must have to live, like food and shelter."],
    ["What is a budget?", ["A bank loan", "A plan for how you'll earn, spend and save money", "A type of insurance", "A tax form"], 1, "A budget is a plan that compares what comes in with what goes out."],
    ["Your wage is $100 a week and your costs are $110. What does that mean?", ["You're saving well", "You're spending more than you earn", "You're earning interest", "Nothing, it's normal"], 1, "Spending more than you earn means going into debt or running out of cash."],
    ["What's a good first step when your income goes up?", ["Spend all of the extra", "Save a part of it before spending", "Ignore it", "Take out a loan"], 1, "Paying yourself first by saving some of each pay is a strong habit."],
    ["Which is a WANT?", ["Rent", "Electricity", "A new gaming console", "Groceries"], 2, "Wants are nice to have but not essential."] ] },
  { title: "Saving & Interest", moduleKey: "termdeposit", description: "How saving grows and why locking money away can pay.", questions: [
    ["What is interest on savings?", ["A fee the bank charges you", "Money the bank pays you for keeping your money there", "A type of tax", "A discount in a shop"], 1, "Banks pay you interest to use your savings."],
    ["What is compound interest?", ["Interest only on your first deposit", "Interest on your savings AND on past interest", "Interest you pay on a loan only", "A bank fee"], 1, "Interest earns interest, so savings can grow faster over time."],
    ["What is a term deposit?", ["Money you can take out any time", "Money locked away for a set time at a fixed rate", "A shop voucher", "A credit card"], 1, "You agree not to touch it until the end of the term, and are rewarded with a better rate."],
    ["What happens if you take money out of a term deposit early?", ["Nothing", "You may pay a fee", "You earn double", "The bank gives you a bonus"], 1, "Early withdrawal usually costs a fee, so only lock away money you won't need."],
    ["Which helps your savings grow the most?", ["Saving a little every week", "Spending it first and saving what's left", "Hiding it at home", "Never saving"], 0, "Regular saving over time adds up, especially with interest."] ] },
  { title: "Borrowing Wisely", moduleKey: "loan", description: "Loans, interest and credit cards.", questions: [
    ["When you borrow money you must...", ["Only pay back what you borrowed", "Pay back what you borrowed PLUS interest", "Pay nothing", "Pay only if you feel like it"], 1, "Interest is the cost of borrowing."],
    ["Which loan costs the most?", ["$100 at 1% a week for 4 weeks", "$100 at 3% a week for 4 weeks", "Both cost the same", "They are free"], 1, "A higher rate means more interest, so it costs more."],
    ["What happens if you miss repayments?", ["Nothing", "You can be charged fees and interest keeps building", "The loan disappears", "You earn interest"], 1, "Missed repayments cost extra and can hurt your lifestyle score."],
    ["A credit card is best used when you...", ["Spend whatever you like", "Can pay the balance off in full each month", "Want to borrow for a long time", "Don't plan to pay"], 1, "Paying in full means you avoid interest."],
    ["Before taking a loan you should ask...", ["Can I afford the repayments?", "Is it cool?", "Will my friends borrow too?", "Can I skip paying?"], 0, "Always check that repayments fit your budget."] ] },
  { title: "Insurance 101", moduleKey: "insurance", description: "Why insurance exists and how a claim works.", questions: [
    ["What is insurance for?", ["Making you rich", "Protecting you from big unexpected costs", "Paying your tax", "Buying a house"], 1, "You pay a small regular amount so a big loss doesn't wipe you out."],
    ["What is an excess?", ["The amount you pay yourself when you make a claim", "A bonus payment", "A type of tax", "The price of the plan"], 0, "Excess is your share of the cost each time you claim."],
    ["Which choice usually has a cheaper weekly price?", ["Higher excess", "Lower excess", "No difference", "Insurance is free"], 0, "If you carry more of the risk yourself, the plan costs less."],
    ["Third-party only car insurance covers...", ["Damage to your own car", "Damage you cause to other people's property", "Everything", "Nothing"], 1, "It doesn't pay for repairs to your own vehicle."],
    ["Is it smart to insure something worth very little?", ["Always", "Usually not, the cost may not be worth it", "Yes, always the dearest plan", "Never insure anything"], 1, "Insure what you can't afford to lose or replace."] ] },
  { title: "Investing Basics", moduleKey: "market", description: "Shares, risk and spreading your money around.", questions: [
    ["What is a share?", ["A loan to a company", "A small piece of ownership in a company", "A bank account", "A tax"], 1, "Shareholders own a small part of the company."],
    ["Share prices...", ["Never change", "Go up and down", "Only go up", "Only go down"], 1, "Prices move as people buy and sell."],
    ["What does 'diversify' mean?", ["Put all your money in one company", "Spread your money across different investments", "Sell everything", "Borrow to invest"], 1, "Spreading your money lowers the harm if one investment does badly."],
    ["Higher possible returns usually mean...", ["Lower risk", "Higher risk", "No risk", "Guaranteed profit"], 1, "Risk and return go hand in hand."],
    ["Investing money you need next week is...", ["A great idea", "Risky, because prices could drop", "Always profitable", "Required"], 1, "Only invest money you won't need soon."] ] },
  { title: "KiwiSaver Basics", moduleKey: "kiwisaver", description: "Saving for later with help from your employer and the government.", questions: [
    ["What is KiwiSaver?", ["A savings scheme to help you save for retirement and a first home", "A type of loan", "A game", "A shop"], 0, "It's a long-term savings scheme."],
    ["Who adds money to your KiwiSaver?", ["Only you", "You, your employer and the government", "Only the bank", "Nobody"], 1, "Employer and government contributions are a big part of the benefit."],
    ["Why is KiwiSaver money hard to take out early?", ["It's meant to be for the long term", "Banks like keeping it", "It isn't real money", "It's a mistake"], 0, "The aim is to build a nest egg for later."],
    ["Which fund usually grows the most over a long time, with the most ups and downs?", ["Conservative", "Balanced", "Growth", "They're all the same"], 2, "Growth funds hold more shares, so they swing more."],
    ["Joining KiwiSaver early helps because...", ["Money has longer to grow", "You pay less tax", "It's free money", "You get more holidays"], 0, "More time means more growth through compounding."] ] }
];
// The other nine modules, so every other lockable module has a ready-made quiz (see BT_ALL_QUIZZES).
const BT_QUIZZES_MORE = [
  { title: "Banking Basics", moduleKey: "bank", description: "Savings accounts, fees and keeping your money safe.", questions: [
    ["What is a savings account mainly for?", ["Everyday shopping", "Keeping money safe while it earns interest", "Borrowing money", "Paying tax"], 1, "Savings accounts hold money you don't need right now and pay you interest for it."],
    ["A bank fee is...", ["Money the bank pays you", "A charge for using a bank service", "A gift", "Interest"], 1, "Fees are charges, so it pays to know which ones your account has."],
    ["Why check your balance regularly?", ["To spot mistakes and avoid overspending", "To earn extra interest", "The bank requires it", "There's no reason"], 0, "Knowing your balance helps you stay in control of your money."],
    ["You should share your PIN or password with...", ["Friends", "Nobody", "Classmates you trust", "Anyone who asks nicely"], 1, "Keep passwords and PINs private, always."],
    ["An account with a higher interest rate will usually...", ["Grow your savings faster", "Cost you more fees", "Shrink your savings", "Close on its own"], 0, "A higher rate means more interest each time it is paid."] ] },
  { title: "Smart Shopping", moduleKey: "store", description: "Needs, wants and getting good value.", questions: [
    ["Before buying something, a smart first question is...", ["Does everyone have one?", "Do I need it, and can I afford it?", "Is it on sale?", "Is it expensive?"], 1, "Need and affordability come before price or popularity."],
    ["A sale price is only a good deal if...", ["It's really cheap", "You actually needed the item", "It's popular", "It's limited stock"], 1, "A bargain on something you didn't need is still money spent."],
    ["Impulse buying means...", ["Planning a purchase carefully", "Buying on a sudden urge without thinking", "Saving for something", "Returning an item"], 1, "Pausing before you buy beats impulse spending."],
    ["Which is most likely to keep its value?", ["A snack", "A lasting item like a bike", "A movie ticket", "A drink"], 1, "Things that last hold value; things you use up don't."],
    ["Comparing prices before you buy helps you...", ["Spend more", "Find better value", "Waste time", "Avoid saving"], 1, "A little comparing can save real money."] ] },
  { title: "Work & Wages", moduleKey: "jobs", description: "Gross pay, take-home pay, tax and promotions.", questions: [
    ["Gross wage is...", ["Pay after tax", "Pay before tax is taken out", "A bonus", "Your savings"], 1, "Gross is the headline figure before anything is deducted."],
    ["Net (take-home) pay is...", ["Pay before tax", "Pay after tax and deductions", "Total yearly pay", "Interest earned"], 1, "Net pay is what actually lands in your account."],
    ["Why does tax come out of your pay?", ["It funds public services like schools and hospitals", "It's a punishment", "It's an employer fee", "It's a bank rule"], 0, "Tax pays for things we all share."],
    ["A promotion usually means...", ["Less pay", "More responsibility and often higher pay", "Losing your job", "No change at all"], 1, "Taking on more usually earns more."],
    ["Turning up reliably and doing good work helps you...", ["Get promoted and keep your job", "Avoid tax", "Earn interest", "Nothing"], 0, "Reliability is how people move up."] ] },
  { title: "Getting Around", moduleKey: "transport", description: "What vehicles really cost to own and run.", questions: [
    ["Owning a car costs more than its price because of...", ["Nothing, the price is all", "Running costs like fuel, insurance and repairs", "Discounts", "Free servicing"], 1, "Running costs keep coming after you buy."],
    ["Compared with a car, a bike usually has...", ["Higher running costs", "Lower running costs", "The same running costs", "Fuel costs"], 1, "Bikes are cheap to run."],
    ["Public transport can save money when...", ["You travel rarely", "It replaces regular trips you'd drive and pay running costs for", "Never", "It is always dearer"], 1, "Regular trips are where a pass pays off."],
    ["Depreciation means...", ["A vehicle gains value", "A vehicle loses value over time", "An insurance payout", "A fuel price rise"], 1, "Most vehicles are worth less each year."],
    ["Before buying a vehicle, work out...", ["Only the colour", "If you can afford the price AND the weekly running costs", "What your friends think", "Nothing"], 1, "Count the running costs, not just the price."] ] },
  { title: "Renting & Buying a Home", moduleKey: "property", description: "Mortgages, deposits and the cost of owning.", questions: [
    ["A mortgage is...", ["A gift", "A loan used to buy a home", "A tax", "A rental"], 1, "A mortgage is a loan secured on the home."],
    ["A deposit on a home is...", ["Money paid up front, which reduces what you borrow", "Monthly rent", "Insurance", "A fee"], 0, "A bigger deposit means a smaller loan."],
    ["Compared with owning, renting means you...", ["Own the property", "Pay the landlord and don't build ownership", "Pay nothing", "Pay a mortgage"], 1, "Rent buys you a place to live, not ownership."],
    ["Over a whole mortgage you repay...", ["Less than you borrowed", "More than you borrowed, because of interest", "Exactly what you borrowed", "Nothing"], 1, "Interest is the cost of borrowing."],
    ["Besides the mortgage, owning a home also costs...", ["Maintenance, insurance and rates", "Nothing", "Only tax", "Only the deposit"], 0, "Ownership has ongoing costs."] ] },
  { title: "Handling Big Surprises", moduleKey: "bigevents", description: "Emergency savings and being ready for the unexpected.", questions: [
    ["An emergency fund is...", ["Money for a holiday", "Savings set aside for unexpected costs", "A loan", "A share"], 1, "It's your cushion for surprises."],
    ["What helps most when something unexpected costs a lot?", ["Savings and insurance", "Having spent everything", "Ignoring it", "Borrowing without a plan"], 0, "Being prepared makes surprises manageable."],
    ["Why is insurance helpful for big events?", ["It pays part of big unexpected costs", "It stops events happening", "It makes you rich", "It's free"], 0, "Insurance shares the cost of a big loss."],
    ["With a big bill and no savings, you may have to...", ["Borrow, which adds interest", "Ignore it", "Earn it back instantly", "Nothing"], 0, "Borrowing for emergencies makes them cost more."],
    ["The best time to build an emergency fund is...", ["After the emergency", "Before you need it", "Never", "When you're broke"], 1, "Start before the surprise arrives."] ] },
  { title: "Lifestyle & Wellbeing", moduleKey: "life", description: "Balancing enjoyment, needs and the future.", questions: [
    ["A good money balance includes...", ["Only working", "Needs, some enjoyment, and saving for later", "Only spending", "Only saving"], 1, "Balance beats going to either extreme."],
    ["Spending to keep up with friends can...", ["Always help you", "Push you to spend more than you can afford", "Save you money", "Earn interest"], 1, "Your budget is yours, not your friends'."],
    ["Lifestyle inflation means...", ["Prices falling", "Spending more every time your income rises", "Saving more", "A type of tax"], 1, "If spending rises with income, nothing is left to save."],
    ["A sign of living within your means is...", ["Spending more than you earn", "Spending less than you earn", "Always borrowing", "Skipping bills"], 1, "Less out than in leaves room to save."],
    ["Buying things mainly for status often...", ["Builds wealth", "Leaves less to save", "Earns interest", "Lowers tax"], 1, "Status spending uses up money you could save."] ] },
  { title: "Gambling & Risk", moduleKey: "gambling", description: "How odds work and why the house wins.", questions: [
    ["Over time, the odds in gambling are set so the house...", ["Loses", "Wins", "Breaks even", "Pays you"], 1, "The odds always favour the house in the long run."],
    ["Which statement is true?", ["After many losses a win is 'due'", "Every play is independent of the last one", "You can learn a system to always win", "Betting more makes winning certain"], 1, "Past results don't change the next one."],
    ["'Chasing losses' means...", ["Betting more to win back what you lost", "Saving", "Stopping", "Budgeting"], 0, "Chasing losses usually makes them bigger."],
    ["A sensible rule about gambling money is to...", ["Use your rent money", "Only risk what you can afford to lose entirely", "Borrow to play", "Bet everything"], 1, "Never risk money you need."],
    ["Compared with saving, gambling is...", ["Guaranteed", "Not a reliable way to grow money", "Safer", "Taxed less"], 1, "Saving is reliable; gambling isn't."] ] },
  { title: "Buying & Selling Fairly", moduleKey: "marketplace", description: "Fair prices, fees and negotiating.", questions: [
    ["A fair price for a used item is usually...", ["More than new", "Less than new, because of wear", "Zero", "Random"], 1, "Used items are worth less than new ones."],
    ["A marketplace fee means...", ["The seller keeps everything", "A share of the sale goes to the marketplace", "The buyer is paid", "It's free"], 1, "Fees come out of what the seller receives."],
    ["Before accepting an offer, check...", ["That it covers what you paid and the fees", "Nothing", "Only the buyer's name", "The time"], 0, "Work out what you'll actually take home."],
    ["Making an offer is...", ["Never allowed", "Negotiating a price both sides agree on", "Cheating", "Stealing"], 1, "Negotiation is a normal part of buying and selling."],
    ["Selling something you no longer need can...", ["Always lose money", "Free up cash for other goals", "Only cost tax", "Be illegal"], 1, "Unused things can become useful cash."] ] }
];
const BT_ALL_QUIZZES = BT_QUIZZES.concat(BT_QUIZZES_MORE);

// Set to true to hand teachers the quizzes already switched on (locking their modules from day one).
// Off by default: a new class shouldn't have 16 locked modules before its first lesson.
const BT_QUIZZES_START_ACTIVE = false;

// The quiz set for a term choice, as plain quiz objects (not yet saved). The bonus for passing is
// $5 for 1 term, $10 for 2 and $20 for 4 (a full year), like the other big-ticket amounts.
// Also used by the Quizzes page as the "recommended quizzes" (1 year = 4 terms).
function t29BaseTemplateQuizzes(terms) {
  const S = t29BaseTemplateScale(terms);
  return BT_ALL_QUIZZES.map(q => ({
    recoKey: q.moduleKey, title: q.title, description: q.description, moduleKey: q.moduleKey,
    passMark: 60, reward: S.M(5), active: BT_QUIZZES_START_ACTIVE, deadline: "",
    questions: q.questions.map(x => ({ text: x[0], options: x[1].slice(), answer: x[2], explain: x[3] }))
  }));
}


// Credit cards (the class's card plans) and extra bank accounts.
const BT_CARD_PLANS = [
  { name: "Starter Card", limit: 100, rate: 5, monthlyFee: 0, freeDays: 7, minLifestyle: 0, minPct: 10, lateFee: 3, theme: "ocean" },
  { name: "Everyday Card", limit: 250, rate: 4, monthlyFee: 0, freeDays: 10, minLifestyle: 8, minPct: 8, lateFee: 4, cashbackPct: 1, theme: "emerald" },
  { name: "Premium Card", limit: 600, rate: 3, monthlyFee: 2, freeDays: 13, minLifestyle: 18, minPct: 5, lateFee: 5, cashbackPct: 2, storeDiscountPct: 5, theme: "gold" }
];
const BT_ACCOUNT_PLANS = [
  { name: "Everyday Plus", kind: "everyday", blurb: "A second account for spending, with no fees.", theme: "ocean" },
  { name: "Rainy Day Saver", kind: "savings", blurb: "A little more interest, with limits on taking money out.", rate: 1.8, minBalance: 20, maxWithdrawals: 2, withdrawFee: 1, theme: "teal" },
  { name: "Goal Saver", kind: "savings", blurb: "Our best interest, plus a bonus for not touching it.", rate: 2, bonusRate: 0.5, minBalance: 50, maxWithdrawals: 1, withdrawFee: 2, minLifestyle: 8, theme: "violet" }
];

// The stock market: fictional companies. [name, start price, shares, daily move range % (min,max)]
const BT_COMPANIES = [
  ["Kiwi Dairy Co-op", 12, 200, 0.5, 2.5],
  ["Southern Cross Energy", 20, 200, 1, 4],
  ["Pohutukawa Foods", 15, 200, 1, 4],
  ["Fernleaf Sports", 8, 300, 1.5, 5],
  ["Moana Tourism", 18, 200, 1, 6],
  ["Aroha Tech", 30, 150, 2, 7]
];

/* ---------------- Builder ---------------- */
function _btMoney(n) { return Math.round(Number(n) * 100) / 100; }

// Term options the teacher can choose from when picking the base template.
// Pass the chosen `terms` number to createClassFromBaseTemplate / applyBaseTemplateToClass
// (and to t29BaseTemplateSummary for the "what's included" panel). Default is 1.
const T29_BASE_TEMPLATE_TERM_OPTIONS = [
  { terms: 1, label: "1 term", weeks: 10, blurb: "About 10 weeks. Small prices, quick results." },
  { terms: 2, label: "2 terms", weeks: 20, blurb: "About 20 weeks. Big-ticket prices and limits are doubled." },
  { terms: 4, label: "4 terms (full year)", weeks: 40, blurb: "About 40 weeks. Big-ticket prices and limits are 4x, with longer loans, mortgages and promotions." }
];

// Scale for a term choice. money: one-off prices, balances and limits (x1 / x2 / x4).
// time: weeks-based things (x1 / x1.5 / x2). Weekly flows (wages, rent, bills,
// side hustles, interest and tax rates) are never scaled; weekly events scale gently (see _btScaleEvent). M() and W() apply the scale.
function t29BaseTemplateScale(terms) {
  const t = [1, 2, 4].includes(Number(terms)) ? Number(terms) : 1;
  const time = t === 1 ? 1 : t === 2 ? 1.5 : 2;
  return { terms: t, money: t, time, M: n => _btMoney(Number(n) * t), W: n => Math.max(1, Math.round(Number(n) * time)) };
}

// A weekly random event with the scale applied. Weekly events happen 2-5 times a week, so they scale
// gently (x1 / x1.5 / x2, the same as time-based things) rather than with the big x1 / x2 / x4 prices.
// Insurance payouts and every choice amount scale with it, so a claim still pays what it should.
function _btScaleEvent(e, S) {
  const E = n => Math.round(Number(n) * S.time);
  return {
    ...e,
    ...(e.amount != null ? { amount: E(e.amount) } : {}),
    ...(e.cover ? { cover: e.cover.map(c => [c[0], E(c[1])]) } : {}),
    ...(e.options ? { options: e.options.map(o => [o[0], E(o[1]), o[2]]) } : {})
  };
}
// The shapes addEventDef / addBigEventDef (and the builders behind them) take.
function _btEventInput(e) {
  const isChoice = e.type === "choice";
  return {
    type: isChoice ? "choice" : "fixed", name: e.name, amount: e.amount || 0, description: e.desc,
    repeatable: !!e.repeatable, severity: e.bad ? "bad" : "neutral",
    coverage: e.coverage || "general", incident: e.incident || null,
    insuranceCover: (e.cover || []).map(c => ({ type: c[0], payout: c[1] })),
    options: (e.options || []).map(o => ({ label: o[0], amount: o[1], outcome: o[2] }))
  };
}
function _btBigEventInput(e) {
  return {
    name: e.name, module: e.module, kind: e.kind === "good" ? "good" : "bad", incident: e.incident || null,
    insuranceCover: (e.cover || []).map(c => ({ type: c[0], payout: c[1] })),
    cost: e.cost, costMode: e.costMode, costPercent: e.costPercent,
    description: e.desc, takesAsset: e.takes !== false
  };
}

// The content tables with the term scale applied (1 term = the tables above, unchanged).
function t29BaseTemplateData(terms) {
  const S = t29BaseTemplateScale(terms), M = S.M, W = S.W;
  return {
    jobs: BT_JOBS.map(j => ({ ...j, promote: W(j.promote) })),
    store: BT_STORE.map(s => s[3] ? [s[0], M(s[1]), ...s.slice(2)] : s), // lasting items only; treats stay small
    properties: BT_PROPERTIES.map(p => ({ ...p, price: M(p.price), weeks: W(p.weeks) })),
    vehicles: BT_VEHICLES.map(v => ({ ...v, price: M(v.price) })),
    bigEvents: BT_BIG_EVENTS.map(e => ({
      ...e,
      ...(e.cost != null && e.costMode !== "percent" ? { cost: M(e.cost) } : {}),
      ...(e.cover ? { cover: e.cover.map(c => [c[0], M(c[1])]) } : {})
    })),
    events: BT_EVENTS.map(e => _btScaleEvent(e, S)),
    life: BT_LIFE.map(l => l.b.cashOnce ? { ...l, b: { ...l.b, cashOnce: M(l.b.cashOnce) } } : l),
    cards: BT_CARD_PLANS.map(p => ({ ...p, limit: M(p.limit) })),
    accounts: BT_ACCOUNT_PLANS.map(p => p.minBalance ? { ...p, minBalance: M(p.minBalance) } : p),
    companies: BT_COMPANIES.map(c => [c[0], c[1], Math.round(c[2] * S.money), c[3], c[4]]) // more shares, same prices
  };
}

// The ready-made random events and big events for a term choice, as plain inputs (not yet saved).
// Used by the Teacher and Big Events pages as the "recommended events" for a class built from scratch.
function t29BaseTemplateEventInputs(terms) {
  return t29BaseTemplateData(terms).events.map(_btEventInput);
}
function t29BaseTemplateBigEventInputs(terms) {
  return t29BaseTemplateData(terms).bigEvents.map(_btBigEventInput);
}

function t29ApplyBaseTemplate(cls, terms) {
  const S = t29BaseTemplateScale(terms), M = S.M, W = S.W, d = t29BaseTemplateData(terms);
  // ---- Core money settings ----
  cls.welcomeGrant = M(BT_WELCOME_GRANT);
  cls.interestRate = 1;            // % a week on savings
  cls.cashInterestRate = 0.25;
  cls.interestAuto = true;
  cls.interestFrequency = "weekly";
  cls.interestDay = "Thu";
  cls.payDay = "Fri";
  cls.mortgageDay = "Mon";
  cls.insuranceDay = "Tue";
  cls.transportDay = "Fri";
  cls.dailyTimeLimitMinutes = 90;
  cls.storeSortMode = "manual";

  // ---- Taxes (kept light) ----
  cls.taxRates = { property: 0, transport: 0, interest: 10, gambling: 0 };
  cls.wageTaxBrackets = [ { upTo: 70, rate: 5 }, { upTo: 110, rate: 12 }, { upTo: null, rate: 20 } ];

  // ---- Jobs ----
  cls.jobs = d.jobs.map(j => ({
    id: uid("j"), title: sanitizeUserText(j.title, 60),
    tiers: j.tiers.map(t => ({ id: uid("t"), name: sanitizeUserText(t[0], 60), wage: t[1], description: sanitizeUserText(t[2], 200) })),
    autoPromoteWeeks: j.promote,
    // Every default job is a daily questionnaire: 3 questions from the pool, every school day (Mon-Fri).
    ...(() => { const c = cleanJobLog("quiz", { days: ["Mon", "Tue", "Wed", "Thu", "Fri"], freq: "daily", windowOn: false, attempts: 2, perDay: 3,
      questions: j.qs.map(q => ({ prompt: q[0], options: q[1], correct: q[2] })) }); return { logType: c.type, log: c.log }; })()
  }));

  // ---- Store ----
  cls.storeItems = d.store.map(s => ({
    id: uid("item"), name: s[0], price: s[1], description: s[4], effect: s[5],
    stock: null, stockTotal: null, sold: 0, stars: s[2], countsNetWorth: s[3], archived: false
  }));

  // ---- Properties for sale (one entry per unit, grouped per listing) ----
  cls.properties = [];
  d.properties.forEach(p => {
    const groupId = uid("propgrp");
    for (let i = 0; i < p.qty; i++) {
      cls.properties.push({
        id: uid("prop"), groupId, name: p.name, price: p.price, comfort: p.comfort,
        mortgageWeeks: p.weeks, mortgageInterestRate: p.rate,
        ...variableListingFields(p.vr[0], p.vr[1]),
        description: p.desc, owner: null,
        rentPerWeek: p.rent, rentDay: "Fri", livingBonusStars: p.bonus,
        occupancy: null, rentLastWeekPaid: null, rentLastPaidDate: null,
        priceHistory: [p.price], priceHistoryDates: [nzDateKey()],
        priceRange: null, purchasePrice: null, mortgage: null, sublet: null
      });
    }
  });
  cls.propertyPriceRange = { min: 0.5, max: 2 };
  cls.propertyBreakFee = M(50);
  cls.movingCost = M(150);

  // ---- School rentals ----
  cls.npcProperties = [];
  BT_RENTALS.forEach(r => {
    const groupId = uid("npcgrp");
    for (let i = 0; i < r.qty; i++) {
      cls.npcProperties.push({
        id: uid("npcprop"), groupId, name: r.name, description: r.desc,
        rentPerWeek: r.rent, rentDay: "Fri", minWeeks: r.min, lifestylePoints: r.pts,
        tenant: null, leaseStartTs: null, leaseStartWeekKey: null, rentLastWeekPaid: null, rentLastPaidDate: null
      });
    }
  });

  // ---- Transport ----
  cls.vehicles = d.vehicles.map(v => ({
    id: uid("veh"), name: v.name, price: v.price, comfort: v.comfort, description: v.desc, owners: [],
    type: normalizeVehicleType(v.type), drivePayout: v.pay || 0,
    weeklyExpense: v.run, publicTransportOffsetPct: v.off, stockLimit: null
  }));
  cls.publicTransportFee = { amount: 20, description: "Weekly bus and train pass" };
  cls.publicTransportFeeOverrides = {};
  cls.truckLicence = { price: M(75), description: "You need a licence before you can buy or drive a truck." };
  cls.sellBackRates = { car: 0.8, truck: 0.85, bike: 0.75 };

  // ---- Insurance ----
  cls.insurancePlans = [];
  [["transport", BT_INSURANCE_TRANSPORT], ["property", BT_INSURANCE_PROPERTY]].forEach(([coverage, group]) => {
    group[1].forEach(p => {
      const existing = insuranceCompaniesOf(cls).find(c => c.coverage === coverage && c.name === group[0]);
      const company = planCompanyFields(cls, coverage, existing ? existing.id : "new", group[0]);
      const insType = cleanInsuranceType(coverage, p[1]);
      cls.insurancePlans.push({
        id: uid("ins"), name: cleanPlanName(p[0], coverage, insType), price: p[2], excess: p[3],
        coverage, insType, ...company, description: p[6], stars: p[4], signupFee: p[5], active: true
      });
    });
  });
  BT_INSURANCE_OTHER.forEach(p => {
    cls.insurancePlans.push({
      id: uid("ins"), name: p.name, price: p.price, excess: p.excess, coverage: p.coverage, insType: null,
      companyId: null, company: null, description: p.desc, stars: p.stars, signupFee: p.signup, active: true
    });
  });

  // ---- Weekly random events and big events (built the same way the teacher's own forms build them) ----
  cls.eventDefs = d.events.map(e => buildEventDef(_btEventInput(e)));
  cls.bigEventDefs = d.bigEvents.map(e => buildBigEventDef(_btBigEventInput(e)));

  // ---- Life events ----
  cls.lifeItems = d.life.map(l => ({
    id: uid("life"), name: l.name, description: l.desc, benefits: sanitizeLifeBenefits(l.b), frequency: "weekly"
  }));

  // ---- Side hustles ----
  cls.sideHustles = BT_HUSTLES.map(h => ({
    id: uid("sh"), name: h.name, description: h.desc, payouts: cleanHustlePayouts(h.pay)
  }));

  // ---- Loans ----
  cls.loanTiers = [
    { min: M(10), max: M(50), termWeeks: W(3), rate: 3 },
    { min: M(50) + 1, max: M(150), termWeeks: W(6), rate: 2.5 },
    { min: M(150) + 1, max: M(400), termWeeks: W(10), rate: 2 },
    { min: M(400) + 1, max: M(1000), termWeeks: W(20), rate: 1.8 }
  ].map(t => ({ id: uid("loantier"), ...t, active: true }));
  cls.maxLoanAmount = M(1000);
  cls.maxLoanCount = 2;

  // ---- Term deposits (rates are % a week, compounding; days = lock-in) ----
  cls.termDepositPlans = [
    { name: "2-Week Saver", minAmount: M(50), days: 14, rate: 1.8, earlyFeePct: 10 },
    { name: "4-Week Saver", minAmount: M(100), days: 28, rate: 2.2, earlyFeePct: 15 },
    { name: "8-Week Saver", minAmount: M(200), days: 56, rate: 2.6, earlyFeePct: 20 }
  ].map(p => ({ id: uid("td"), ...p, active: true }));

  // ---- Credit cards and extra accounts ----
  cls.cardSettings = { enabled: true, approval: "teacher", statementDay: "Fri", splitMin: M(20) };
  cls.cardPlans = d.cards.map(p => cardCleanPlan(p));
  cls.accountSettings = { enabled: true, approval: "instant", maxEveryday: 1, maxSavings: 2 };
  cls.accountPlans = d.accounts.map(p => acctCleanPlan(p));

  // ---- KiwiSaver ----
  cls.kiwiSaver = { enabled: true, govt: true, firstHomeWeeks: W(3), firstHomeKeep: M(50), retired: false, retiredAt: null };

  // ---- Stock market ----
  cls.priceRange = { min: 1, max: 5 };
  cls.companies = d.companies.map(c => ({
    id: uid("co"), name: c[0], price: c[1], totalShares: c[2], availableShares: c[2],
    history: [c[1]], historyDates: [nzDateKey()], holders: {}, costBasis: {},
    priceRange: { min: c[3], max: c[4] }
  }));

  // ---- Gambling: OFF by default (the teacher can switch it on), limits kept small for when they do ----
  cls.gambling = Object.assign({}, cls.gambling, {
    enabled: false, minBet: 1, maxBet: M(10), dailyBuyInLimit: M(20), dailyWinLimit: M(40)
  });
  cls.blackjack = { enabled: true, minBet: 1, maxBet: M(10) };

  // ---- Trade Centre and peer rentals ----
  cls.marketplace = {
    enabled: true, requireApproval: false, allowOffers: true, minPricePct: 50, maxPricePct: 150,
    maxActiveListings: 3, feePct: 5, allowStore: true, allowVehicle: true, allowProperty: false
  };
  cls.propertyRentals = { enabled: true, requireApproval: false, minPricePct: 50, maxPricePct: 150, maxLeaseWeeks: 6 };

  // ---- Lifestyle rating ----
  cls.lifestyleConfig = {
    property: { enabled: true, weight: 4 }, store: { enabled: true, weight: 2 },
    insurance: { enabled: true, weight: 2 }, transport: { enabled: true, weight: 3 },
    loan: { enabled: true, perAmount: M(100), points: 1 },
    creditCard: { enabled: true, perAmount: M(100), points: 1 }
  };
  cls.lifestyleThresholds = [
    { min: 0, max: 8, label: "Struggling", minNetWorth: 0, minPropertyComfort: 0, minTransportComfort: 0 },
    { min: 8, max: 18, label: "Modest", minNetWorth: 0, minPropertyComfort: 0, minTransportComfort: 0 },
    { min: 18, max: 32, label: "Comfortable", minNetWorth: M(150), minPropertyComfort: 0, minTransportComfort: 0 },
    { min: 32, max: 50, label: "Luxurious", minNetWorth: M(750), minPropertyComfort: 0, minTransportComfort: 0 },
    { min: 50, max: 75, label: "Starlight Seeker", minNetWorth: M(1500), minPropertyComfort: 0, minTransportComfort: 1 },
    { min: 75, max: 110, label: "Star Gazer", minNetWorth: M(2000), minPropertyComfort: 1, minTransportComfort: 1 },
    { min: 110, max: 200, label: "Comet Catcher", minNetWorth: M(3000), minPropertyComfort: 2, minTransportComfort: 1 }
  ];
  cls.lifestyleLock = { threshold: 0, modules: [] };

  // ---- Quizzes: one per module, bonus scaled by term. Paused until the teacher activates them (BT_QUIZZES_START_ACTIVE) ----
  cls.quizzes = t29BaseTemplateQuizzes(terms).map(q => normalizeQuiz(q));
  cls.quizGate = { enabled: false }; // legacy field, no longer used (a quiz locks its module when active)

  cls.baseTemplate = T29_BASE_TEMPLATE_LABEL; // a small marker, so it's clear where the setup came from
  cls.baseTemplateTerms = S.terms;            // which term option was chosen (1, 2 or 4)
  return cls;
}

// A short list of what's in the template, for the "what's included" panel.
function t29BaseTemplateSummary(terms) {
  const S = t29BaseTemplateScale(terms), d = t29BaseTemplateData(terms);
  const propUnits = d.properties.reduce((a, p) => a + p.qty, 0);
  return [
    `${d.jobs.length} daily-questionnaire jobs (maths, science, history and more) with 3 pay tiers each ($${d.jobs[0].tiers[0][1]}–$${Math.max(...d.jobs.map(j => j.tiers[2][1]))} a week)`,
    `${d.store.length} store items ($${d.store[0][1]}–$${d.store[d.store.length - 1][1]})`,
    `${d.properties.length} home listings (${propUnits} homes, $${d.properties[0].price}–$${d.properties[d.properties.length - 1].price}) and ${BT_RENTALS.length} rental types`,
    `${d.vehicles.length} vehicles (bikes, cars and a truck) and a weekly bus pass`,
    `Insurance for cars, homes, income and everyday life`,
    `${BT_EVENTS.length} real-life weekly random events and ${BT_BIG_EVENTS.length} big events (job loss, house and vehicle disasters, windfalls), scaled to the term`,
    `${BT_LIFE.length} life events and ${BT_HUSTLES.length} side hustles`,
    `Loans, term deposits, credit cards and extra bank accounts`,
    `KiwiSaver and a stock market with ${BT_COMPANIES.length} companies`,
    `${BT_ALL_QUIZZES.length} financial literacy quizzes, one for every module, with a $${S.M(5)} bonus for passing (ready to switch on as unlock gates)`,
    `Light tax, a small gambling limit, and a trade centre for students`,
    `Paced for ${S.terms} term${S.terms > 1 ? "s" : ""} (about ${S.terms * 10} weeks)`,
    `Students start with $${S.M(BT_WELCOME_GRANT)}`
  ];
}

/* ---------------- Creating a class from it ---------------- */
// Teacher Home: a brand new class that starts from the base template.
async function createClassFromBaseTemplate(teacherUsername, className, terms) {
  const teacher = await getUser(teacherUsername);
  if (!teacher || teacher.role !== "teacher") return { ok: false, error: "Teacher account not found." };
  if (!className || !className.trim()) return { ok: false, error: "Enter a class name." };

  const code = await _freshClassCode();
  const cls = _cloneDoc(t29ApplyBaseTemplate(defaultClassData(code, className.trim(), teacherUsername), terms));

  await classesCol().doc(code).set(cls);
  await usersCol().doc(teacherUsername).update({ classCode: code });
  return { ok: true, code };
}

// Signup: the class already exists (and is empty), so lay the template over it.
// Only ever used on a class with no students, so nothing of anyone's is touched.
async function applyBaseTemplateToClass(classCode, terms) {
  const existing = await getClass(classCode);
  if (!existing) return { ok: false, error: "Class not found." };
  if ((existing.students || []).length) return { ok: false, error: "The base template can only be added to a class with no students." };
  const cls = _cloneDoc(t29ApplyBaseTemplate(defaultClassData(classCode, existing.name, existing.teacher), terms));
  // Keep the things that were already true of this class.
  cls.createdAt = existing.createdAt || cls.createdAt;
  cls.coTeachers = existing.coTeachers || []; cls.coTeacherCode = existing.coTeacherCode || null;
  await classesCol().doc(classCode).set(cls);
  return { ok: true };
}
