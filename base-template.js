/* ===================== The 29 World — Base template =====================
   A ready-made, balanced class setup a teacher can pick instead of
   starting from scratch. Everything in it is scaled for a school TERM
   (about 10 weeks) up to a school YEAR (about 40 weeks): small dollar
   amounts, short mortgage / loan / deposit terms, and weekly rates that
   show their effect quickly.

   The rough economy, so the numbers below make sense together:
     - Starting money ......... $50
     - Weekly wage (gross) .... about $55 (first job) up to $150 (top tier)
     - Weekly take-home ....... about $50 to $125 after tax
     - Typical weekly costs ... transport ~$5 + insurance ~$5-10 + a mortgage
                                or rent of $20-60 + a few random events
     - So in one term a student can build savings, buy a few things, a bike
       or a cheap car, and try a loan or term deposit. Over a year they can
       realistically work toward a mortgage on a modest home.

   Loaded after the data-*.js files, because it reuses their helpers (the
   same cleaners the teacher's own forms use), so everything here has the
   exact shape the rest of the app expects. Nothing in this file touches
   students, balances or history — a base-template class starts empty.
====================================================================== */

const T29_BASE_TEMPLATE_LABEL = "Balanced school-term starter";

/* ---------------- The content ---------------- */
// Jobs: weekly gross wage per tier. autoPromoteWeeks = weeks in a tier
// before moving up automatically (4 = two promotions within a term).
const BT_JOBS = [
  { title: "Café Worker", promote: 4, tiers: [
    ["Kitchenhand", 55, "Washing up, prep and tidying."],
    ["Barista", 72, "Makes the coffees and runs the machine."],
    ["Café Manager", 98, "Runs the roster, orders and the team."] ] },
  { title: "Retail Assistant", promote: 4, tiers: [
    ["Shop Assistant", 55, "Serves customers and stocks shelves."],
    ["Senior Assistant", 74, "Handles the till and trains new staff."],
    ["Store Manager", 100, "Runs the whole shop."] ] },
  { title: "Teacher Aide", promote: 5, tiers: [
    ["Classroom Aide", 60, "Helps students in the classroom."],
    ["Senior Aide", 80, "Leads small groups and supports teachers."],
    ["Learning Support Lead", 102, "Plans support for the whole school."] ] },
  { title: "Gardener", promote: 4, tiers: [
    ["Garden Hand", 52, "Mowing, weeding and planting."],
    ["Landscaper", 70, "Builds and maintains gardens."],
    ["Landscape Designer", 94, "Designs gardens for clients."] ] },
  { title: "Office Administrator", promote: 5, tiers: [
    ["Receptionist", 62, "Answers phones and greets visitors."],
    ["Admin Officer", 84, "Handles bookings, invoices and records."],
    ["Office Manager", 112, "Manages the office and its staff."] ] },
  { title: "Builder", promote: 6, tiers: [
    ["Apprentice", 62, "Learning the trade on site."],
    ["Qualified Builder", 98, "Builds and renovates."],
    ["Site Manager", 135, "Runs the building site and the crew."] ] },
  { title: "Nurse", promote: 6, tiers: [
    ["Nursing Assistant", 70, "Supports patients and nurses."],
    ["Registered Nurse", 104, "Cares for patients on the ward."],
    ["Charge Nurse", 138, "Leads the ward."] ] },
  { title: "IT Support", promote: 6, tiers: [
    ["Helpdesk Assistant", 74, "Fixes everyday computer problems."],
    ["Developer", 112, "Builds and tests software."],
    ["Senior Developer", 150, "Leads software projects."] ] }
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
  ["Home Entertainment System", 200, 3, true, "A big screen and surround sound.", "Raises your lifestyle a lot."]
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
  { name: "Shared Flat Room", rent: 15, min: 1, pts: 2, qty: 10, desc: "A room in a shared flat. Cheap and cheerful." },
  { name: "One-Bedroom Flat", rent: 25, min: 2, pts: 5, qty: 8, desc: "Your own small flat." },
  { name: "Two-Bedroom Unit", rent: 36, min: 2, pts: 8, qty: 6, desc: "Room to spread out, with a small yard." },
  { name: "Family House (Rental)", rent: 50, min: 3, pts: 12, qty: 4, desc: "A comfortable family house to rent." }
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
  { name: "Delivery Truck", type: "truck", price: 900, comfort: 2, run: 15, off: 100, pay: 6,
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
    options: [["Treat yourself", -20, "You bought something you didn't need."], ["Save your money", 0, "You walked right past."]] }
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
  { name: "Financial Mentor", desc: "Good advice cuts your tax bill.", b: { taxCutPercent: 10, lifestylePoints: 1 } },
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

function t29ApplyBaseTemplate(cls) {
  // ---- Core money settings ----
  cls.welcomeGrant = 50;
  cls.interestRate = 1.5;          // % a week on savings
  cls.cashInterestRate = 0;
  cls.interestAuto = true;
  cls.interestFrequency = "weekly";
  cls.interestDay = "Fri";
  cls.payDay = "Fri";
  cls.mortgageDay = "Fri";
  cls.insuranceDay = "Fri";
  cls.transportDay = "Fri";
  cls.dailyTimeLimitMinutes = null;
  cls.storeSortMode = "manual";

  // ---- Taxes (kept light) ----
  cls.taxRates = { property: 0, transport: 0, interest: 10, gambling: 10 };
  cls.wageTaxBrackets = [ { upTo: 70, rate: 5 }, { upTo: 110, rate: 12 }, { upTo: null, rate: 20 } ];

  // ---- Jobs ----
  cls.jobs = BT_JOBS.map(j => ({
    id: uid("j"), title: sanitizeUserText(j.title, 60),
    tiers: j.tiers.map(t => ({ id: uid("t"), name: sanitizeUserText(t[0], 60), wage: t[1], description: sanitizeUserText(t[2], 200) })),
    autoPromoteWeeks: j.promote
  }));

  // ---- Store ----
  cls.storeItems = BT_STORE.map(s => ({
    id: uid("item"), name: s[0], price: s[1], description: s[4], effect: s[5],
    stock: null, stockTotal: null, sold: 0, stars: s[2], countsNetWorth: s[3], archived: false
  }));

  // ---- Properties for sale (one entry per unit, grouped per listing) ----
  cls.properties = [];
  BT_PROPERTIES.forEach(p => {
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
  cls.propertyBreakFee = 10;
  cls.movingCost = 5;

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
  cls.vehicles = BT_VEHICLES.map(v => ({
    id: uid("veh"), name: v.name, price: v.price, comfort: v.comfort, description: v.desc, owners: [],
    type: normalizeVehicleType(v.type), drivePayout: v.pay || 0,
    weeklyExpense: v.run, publicTransportOffsetPct: v.off, stockLimit: null
  }));
  cls.publicTransportFee = { amount: 5, description: "Weekly bus and train pass" };
  cls.publicTransportFeeOverrides = {};
  cls.truckLicence = { price: 60, description: "You need a licence before you can buy or drive a truck." };
  cls.sellBackRates = { car: 0.75, truck: 0.75, bike: 0.8 };

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
  cls.bigEventDefs = BT_BIG_EVENTS.map(e => {
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
  cls.lifeItems = BT_LIFE.map(l => ({
    id: uid("life"), name: l.name, description: l.desc, benefits: sanitizeLifeBenefits(l.b), frequency: "weekly"
  }));

  // ---- Side hustles ----
  cls.sideHustles = BT_HUSTLES.map(h => ({
    id: uid("sh"), name: h.name, description: h.desc, payouts: cleanHustlePayouts(h.pay)
  }));

  // ---- Loans ----
  cls.loanTiers = [
    { min: 10, max: 50, termWeeks: 3, rate: 3 },
    { min: 51, max: 150, termWeeks: 6, rate: 2.5 },
    { min: 151, max: 400, termWeeks: 10, rate: 2 },
    { min: 401, max: 1000, termWeeks: 20, rate: 1.8 }
  ].map(t => ({ id: uid("loantier"), ...t, active: true }));
  cls.maxLoanAmount = 1000;
  cls.maxLoanCount = 2;

  // ---- Term deposits (rates are % a week, compounding; days = lock-in) ----
  cls.termDepositPlans = [
    { name: "2-Week Saver", minAmount: 50, days: 14, rate: 1.8, earlyFeePct: 10 },
    { name: "4-Week Saver", minAmount: 100, days: 28, rate: 2.2, earlyFeePct: 15 },
    { name: "8-Week Saver", minAmount: 200, days: 56, rate: 2.6, earlyFeePct: 20 }
  ].map(p => ({ id: uid("td"), ...p, active: true }));

  // ---- Credit cards and extra accounts ----
  cls.cardSettings = { enabled: true, approval: "teacher", statementDay: "Fri", splitMin: 20 };
  cls.cardPlans = BT_CARD_PLANS.map(p => cardCleanPlan(p));
  cls.accountSettings = { enabled: true, approval: "instant", maxEveryday: 1, maxSavings: 2 };
  cls.accountPlans = BT_ACCOUNT_PLANS.map(p => acctCleanPlan(p));

  // ---- KiwiSaver ----
  cls.kiwiSaver = { enabled: true, govt: true, firstHomeWeeks: 3, firstHomeKeep: 50, retired: false, retiredAt: null };

  // ---- Stock market ----
  cls.priceRange = { min: 1, max: 5 };
  cls.companies = BT_COMPANIES.map(c => ({
    id: uid("co"), name: c[0], price: c[1], totalShares: c[2], availableShares: c[2],
    history: [c[1]], historyDates: [nzDateKey()], holders: {}, costBasis: {},
    priceRange: { min: c[3], max: c[4] }
  }));

  // ---- Gambling: OFF by default (the teacher can switch it on), limits kept small for when they do ----
  cls.gambling = Object.assign({}, cls.gambling, {
    enabled: false, minBet: 1, maxBet: 10, dailyBuyInLimit: 20, dailyWinLimit: 40
  });
  cls.blackjack = { enabled: true, minBet: 1, maxBet: 10 };

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
    loan: { enabled: true, perAmount: 100, points: 1 },
    creditCard: { enabled: true, perAmount: 100, points: 1 }
  };
  cls.lifestyleThresholds = [
    { min: 0, max: 8, label: "Struggling", minNetWorth: 0, minPropertyComfort: 0, minTransportComfort: 0 },
    { min: 8, max: 18, label: "Modest", minNetWorth: 0, minPropertyComfort: 0, minTransportComfort: 0 },
    { min: 18, max: 32, label: "Comfortable", minNetWorth: 150, minPropertyComfort: 0, minTransportComfort: 0 },
    { min: 32, max: 50, label: "Good", minNetWorth: 500, minPropertyComfort: 0, minTransportComfort: 0 },
    { min: 50, max: 100, label: "Luxurious", minNetWorth: 1500, minPropertyComfort: 0, minTransportComfort: 0 }
  ];
  cls.lifestyleLock = { threshold: 0, modules: [] };

  // ---- Quizzes: ready to use; locks stay off until the teacher turns them on ----
  cls.quizzes = BT_QUIZZES.map(q => normalizeQuiz({
    title: q.title, description: q.description, moduleKey: q.moduleKey, passMark: 60, reward: 5, active: true,
    questions: q.questions.map(x => ({ text: x[0], options: x[1], answer: x[2], explain: x[3] }))
  }));
  cls.quizGate = { enabled: false };

  cls.baseTemplate = T29_BASE_TEMPLATE_LABEL; // a small marker, so it's clear where the setup came from
  return cls;
}

// A short list of what's in the template, for the "what's included" panel.
function t29BaseTemplateSummary() {
  const propUnits = BT_PROPERTIES.reduce((a, p) => a + p.qty, 0);
  return [
    `${BT_JOBS.length} jobs with 3 pay tiers each ($${BT_JOBS[0].tiers[0][1]}–$${Math.max(...BT_JOBS.map(j => j.tiers[2][1]))} a week)`,
    `${BT_STORE.length} store items ($${BT_STORE[0][1]}–$${BT_STORE[BT_STORE.length - 1][1]})`,
    `${BT_PROPERTIES.length} home listings (${propUnits} homes, $${BT_PROPERTIES[0].price}–$${BT_PROPERTIES[BT_PROPERTIES.length - 1].price}) and ${BT_RENTALS.length} rental types`,
    `${BT_VEHICLES.length} vehicles (bikes, cars and a truck) and a weekly bus pass`,
    `Insurance for cars, homes, income and everyday life`,
    `${BT_EVENTS.length} weekly random events and ${BT_BIG_EVENTS.length} big events`,
    `${BT_LIFE.length} life events and ${BT_HUSTLES.length} side hustles`,
    `Loans, term deposits, credit cards and extra bank accounts`,
    `KiwiSaver and a stock market with ${BT_COMPANIES.length} companies`,
    `${BT_QUIZZES.length} financial literacy quizzes (module locks off until you turn them on)`,
    `Light tax, a small gambling limit, and a trade centre for students`,
    `Students start with $50`
  ];
}

/* ---------------- Creating a class from it ---------------- */
// Teacher Home: a brand new class that starts from the base template.
async function createClassFromBaseTemplate(teacherUsername, className) {
  const teacher = await getUser(teacherUsername);
  if (!teacher || teacher.role !== "teacher") return { ok: false, error: "Teacher account not found." };
  if (!className || !className.trim()) return { ok: false, error: "Enter a class name." };

  const code = await _freshClassCode();
  const cls = _cloneDoc(t29ApplyBaseTemplate(defaultClassData(code, className.trim(), teacherUsername)));

  await classesCol().doc(code).set(cls);
  await usersCol().doc(teacherUsername).update({ classCode: code });
  return { ok: true, code };
}

// Signup: the class already exists (and is empty), so lay the template over it.
// Only ever used on a class with no students, so nothing of anyone's is touched.
async function applyBaseTemplateToClass(classCode) {
  const existing = await getClass(classCode);
  if (!existing) return { ok: false, error: "Class not found." };
  if ((existing.students || []).length) return { ok: false, error: "The base template can only be added to a class with no students." };
  const cls = _cloneDoc(t29ApplyBaseTemplate(defaultClassData(classCode, existing.name, existing.teacher)));
  // Keep the things that were already true of this class.
  cls.createdAt = existing.createdAt || cls.createdAt;
  cls.coTeachers = existing.coTeachers || []; cls.coTeacherCode = existing.coTeacherCode || null;
  await classesCol().doc(classCode).set(cls);
  return { ok: true };
}
