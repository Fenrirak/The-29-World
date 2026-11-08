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
   (wages, rent, bills, weekly events, side hustles) stays the same, so a
   week always feels the same. What scales is the big stuff: one-off prices,
   balances and limits go x1 / x2 / x4, and time-based things (mortgage and
   loan lengths, promotions, KiwiSaver wait) go x1 / x1.5 / x2.
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
  ["Bubble Tea", 5, 0, false, "A cold drink after school.", "A small treat — no lasting effect."],
  ["Movie Night", 12, 0, false, "Tickets and popcorn with friends.", "A fun night out — no lasting effect."],
  ["Dinner Out", 20, 0, false, "A meal at a restaurant.", "A nice treat — no lasting effect."],
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

// Weekly random events. Everyone gets 2-5 a week, so amounts stay small.
// amount: + you receive, - you pay.  cover: insurance payouts (bad property/transport only).
const BT_EVENTS = [
  // good news
  { name: "Found Money on the Footpath", amount: 5, repeatable: true, desc: "You spot a few coins and a note on your way home." },
  { name: "Birthday Money from Family", amount: 20, desc: "A relative sends you a birthday card with cash inside." },
  { name: "Sold Old Clothes Online", amount: 12, repeatable: true, desc: "Someone bought the jacket you never wear." },
  { name: "Won the School Raffle", amount: 15, desc: "Your ticket was drawn out of the bucket." },
  { name: "Helped a Neighbour", amount: 8, repeatable: true, desc: "You helped carry in the groceries and got a thank-you." },
  { name: "Cash-in-Hand Odd Job", amount: 10, repeatable: true, desc: "A quick job washing cars paid cash." },
  { name: "Tutored a Younger Student", amount: 14, repeatable: true, desc: "Your help with maths was worth a few dollars." },
  { name: "Pocket Money Bonus", amount: 6, repeatable: true, desc: "Your family gave you a little extra this week." },
  // bad news (anyone)
  { name: "Library Late Fee", amount: -4, bad: true, repeatable: true, desc: "You forgot to return a book on time." },
  { name: "Lost Your Wallet", amount: -10, bad: true, desc: "You left it on the bus and had to replace your cards." },
  { name: "Cracked Phone Screen", amount: -15, bad: true, desc: "Oops. It slipped out of your hand." },
  { name: "Doctor's Visit", amount: -12, bad: true, repeatable: true, desc: "You came down with the flu and needed a check-up." },
  { name: "Dentist Emergency", amount: -20, bad: true, desc: "A toothache that couldn't wait." },
  // bad news (only students who have the asset)
  { name: "Scratched Car Door", amount: -15, bad: true, coverage: "transport", incident: ["vandalism"], repeatable: true,
    cover: [["comprehensive", 15], ["truck", 15]], desc: "Someone keyed your vehicle in the car park." },
  { name: "Minor Fender Bender", amount: -30, bad: true, coverage: "transport", incident: ["accident", "third-party"],
    cover: [["comprehensive", 30], ["tpft", 12], ["third-party", 12], ["truck", 30]], desc: "A small bump at the traffic lights." },
  { name: "Burglary: Things Stolen", amount: -20, bad: true, coverage: "property", incident: "contents", repeatable: true,
    cover: [["contents", 20], ["sum-insured", 20], ["indemnity", 20]], desc: "Someone broke in and took some belongings." },
  // choices
  { type: "choice", name: "A Friend's Birthday", desc: "Your friend has a birthday this week. What will you do?",
    options: [["Buy a nice gift", -10, "They loved it!"], ["Make a card", -2, "Thoughtful and cheap."], ["Do nothing", 0, "They didn't say anything, but it was a bit awkward."]] },
  { type: "choice", name: "Gold Coin Donation Day", desc: "The school is raising money for charity.",
    options: [["Donate a gold coin", -2, "You helped others."], ["Donate more", -5, "You were really generous."], ["Don't donate", 0, "You kept your money."]] },
  { type: "choice", name: "Lunch Order", desc: "It's lunch time. What do you do?",
    options: [["Buy lunch from the canteen", -6, "Tasty, but pricey."], ["Bring lunch from home", 0, "Cheap and healthy."]] },
  { type: "choice", name: "Concert Tickets", desc: "A band you love is playing this weekend.",
    options: [["Go to the concert", -25, "An amazing night."], ["Watch the highlights online", 0, "Not the same, but free."]] },
  { type: "choice", name: "Big Sale Weekend", desc: "Everything is half price at the mall.",
    options: [["Treat yourself", -20, "You bought something you didn't need, but you still feel quite happy."], ["Save your money", 0, "You walked right past."]] }
];

// Big events: a library of bigger moments a teacher can launch for the class.
// cost: set dollars (or percent of wage for income events). takes = student loses the
// job / property / vehicle if they can't pay and aren't insured.
const BT_BIG_EVENTS = [
  { name: "Workplace Injury", module: "income", kind: "bad", cost: 60, takes: false,
    desc: "You hurt your back at work and need treatment. Income Protection can help." },
  { name: "Job Retraining Course", module: "income", kind: "bad", cost: 80, takes: true,
    desc: "Your role is changing. Pay for a retraining course or lose your job." },
  { name: "Employee of the Month Bonus", module: "income", kind: "good", costMode: "percent", costPercent: 50,
    desc: "Your boss rewards your hard work with half a week's pay." },
  { name: "Major House Fire", module: "property", kind: "bad", incident: "both", cost: 400, takes: true,
    cover: [["sum-insured", 400], ["indemnity", 60], ["contents", 60]],
    desc: "A fire has badly damaged your home and everything in it." },
  { name: "Burst Water Pipes", module: "property", kind: "bad", incident: "house", cost: 120, takes: false,
    cover: [["sum-insured", 120]], desc: "A pipe burst in the night and flooded the house." },
  { name: "Council Rates Rebate", module: "property", kind: "good", cost: 30,
    desc: "The council refunds part of your yearly rates." },
  { name: "Car Accident", module: "transport", kind: "bad", incident: ["accident", "third-party"], cost: 150, takes: true,
    cover: [["comprehensive", 150], ["tpft", 60], ["third-party", 60], ["truck", 150]],
    desc: "You crashed your vehicle and damaged someone else's car too." },
  { name: "Vehicle Stolen", module: "transport", kind: "bad", incident: ["theft"], cost: 120, takes: false,
    cover: [["comprehensive", 120], ["tpft", 120], ["truck", 120]], desc: "Someone broke in and stole parts from your vehicle." },
  { name: "Storm Damage", module: "transport", kind: "bad", incident: ["storm"], cost: 80, takes: false,
    cover: [["comprehensive", 80], ["truck", 80]], desc: "A tree fell on your vehicle in a storm." },
  { name: "Free Warrant of Fitness", module: "transport", kind: "good", cost: 20,
    desc: "A garage gave you a free safety check." },
  { name: "Scholarship Award", module: "general", kind: "good", cost: 80, desc: "You won a scholarship for good grades." },
  { name: "Tax Refund", module: "general", kind: "good", cost: 35, desc: "You overpaid your tax and got some back." },
  { name: "Surprise Inheritance", module: "general", kind: "good", cost: 100, desc: "A distant relative left you a little money." }
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
  { title: "Budgeting Basics", moduleKey: "", description: "Needs, wants and making a plan for your money.", questions: [
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
// time: weeks-based things (x1 / x1.5 / x2). Weekly flows (wages, rent, bills, weekly events,
// side hustles, interest and tax rates) are never scaled. M() and W() apply the scale.
function t29BaseTemplateScale(terms) {
  const t = [1, 2, 4].includes(Number(terms)) ? Number(terms) : 1;
  const time = t === 1 ? 1 : t === 2 ? 1.5 : 2;
  return { terms: t, money: t, time, M: n => _btMoney(Number(n) * t), W: n => Math.max(1, Math.round(Number(n) * time)) };
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
    life: BT_LIFE.map(l => l.b.cashOnce ? { ...l, b: { ...l.b, cashOnce: M(l.b.cashOnce) } } : l),
    cards: BT_CARD_PLANS.map(p => ({ ...p, limit: M(p.limit) })),
    accounts: BT_ACCOUNT_PLANS.map(p => p.minBalance ? { ...p, minBalance: M(p.minBalance) } : p),
    companies: BT_COMPANIES.map(c => [c[0], c[1], Math.round(c[2] * S.money), c[3], c[4]]) // more shares, same prices
  };
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

  // ---- Weekly random events ----
  cls.eventDefs = BT_EVENTS.map(e => {
    const isChoice = e.type === "choice";
    const input = {
      type: isChoice ? "choice" : "fixed", name: e.name, amount: e.amount || 0, description: e.desc,
      repeatable: !!e.repeatable, severity: e.bad ? "bad" : "neutral",
      coverage: e.coverage || "general", incident: e.incident || null,
      insuranceCover: (e.cover || []).map(c => ({ type: c[0], payout: c[1] })),
      options: (e.options || []).map(o => ({ label: o[0], amount: o[1], outcome: o[2] }))
    };
    const amt = weeklyEventAmountFields(input);
    return {
      id: uid("ev"), name: input.name, amount: amt.amountMode === "percent" ? 0 : Number(input.amount) || 0,
      description: input.description, repeatable: input.repeatable,
      severity: input.severity === "bad" ? "bad" : "neutral", active: true,
      ...weeklyEventInsurance(input), ...amt,
      type: isChoice ? "choice" : "fixed", options: isChoice ? cleanEventOptions(input.options) : []
    };
  });

  // ---- Big events ----
  cls.bigEventDefs = d.bigEvents.map(e => {
    const kind = e.kind === "good" ? "good" : "bad";
    const module = resolveBigEventModule(e.module, kind);
    const coverage = MODULE_TO_COVERAGE[module];
    const incident = kind === "bad" ? cleanIncident(coverage, e.incident || null) : null;
    return {
      id: uid("big"), name: e.name, module, kind, incident,
      insuranceCover: kind === "bad"
        ? cleanInsuranceCover(coverage, (e.cover || []).map(c => ({ type: c[0], payout: c[1] })), incident) : [],
      ...cleanBigEventCost({ cost: e.cost, costMode: e.costMode, costPercent: e.costPercent }, module),
      description: e.desc, active: true, takesAsset: e.takes === false ? false : true
    };
  });

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

  // ---- Quizzes: ready to use; locks stay off until the teacher turns them on ----
  cls.quizzes = BT_QUIZZES.map(q => normalizeQuiz({
    title: q.title, description: q.description, moduleKey: q.moduleKey, passMark: 60, reward: M(5), active: true,
    questions: q.questions.map(x => ({ text: x[0], options: x[1], answer: x[2], explain: x[3] }))
  }));
  cls.quizGate = { enabled: false };

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
    `${BT_EVENTS.length} weekly random events and ${BT_BIG_EVENTS.length} big events`,
    `${BT_LIFE.length} life events and ${BT_HUSTLES.length} side hustles`,
    `Loans, term deposits, credit cards and extra bank accounts`,
    `KiwiSaver and a stock market with ${BT_COMPANIES.length} companies`,
    `${BT_QUIZZES.length} financial literacy quizzes (module locks off until you turn them on)`,
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
