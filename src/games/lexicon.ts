import type { LetterCat } from "./score";

type Bank = Record<string, Record<LetterCat, string[]>>;

function parse(raw: string): Bank {
  const out: Bank = {};
  for (const line of raw.trim().split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [letter, ...parts] = trimmed.split("|");
    if (!letter) continue;
    const row: Record<LetterCat, string[]> = { boy: [], girl: [], animal: [], object: [], country: [] };
    for (const part of parts) {
      const idx = part.indexOf(":");
      if (idx < 0) continue;
      const key = part.slice(0, idx) as LetterCat;
      if (!row[key]) continue;
      row[key] = part
        .slice(idx + 1)
        .split(",")
        .map((w) => w.trim())
        .filter(Boolean);
    }
    out[letter] = row;
  }
  return out;
}

const AR = `
ا|boy:احمد,ادم,اسامه,ايمن,امين,انور,ايهاب,ابراهيم|girl:اسماء,اماني,ايه,الاء,اميرة,اسيل,ابتهال,اريج|animal:اسد,ارنب,افعى,اخطبوط,اوز|object:ابريق,اناء,اسفنجة,اكسسوار,اقلام|country:الاردن,اثيوبيا,اسبانيا,استراليا,ايران,ايطاليا,الارجنتين
ب|boy:بدر,بندر,باسل,بلال,باسم,براء|girl:بتول,بشاير,بيان,بدور,بسمة,بنان|animal:بطة,ببغاء,بومة,باندا,بعوضة,بقرة|object:باب,بطانية,براد,بكرة,بطاقة,برواز|country:البحرين,البرازيل,بلجيكا,بنغلاديش,بولندا
ت|boy:تركي,تميم,توفيق,تامر,تيم|girl:تالا,تالين,تسنيم,تهاني,تماضر|animal:تمساح,تنين,تيس|object:تلفزيون,تفاح,تمثال,تلسكوب,تابلت|country:تركيا,تونس,تشاد,تشيلي,تايلاند,تنزانيا
ج|boy:جابر,جاسم,جمال,جواد,جلال|girl:جواهر,جود,جنى,جمانة,جميلة|animal:جمل,جاموس,جرادة,جربوع|object:جرس,جوال,جرة,جسر,جيتار|country:الجزائر,جامايكا,جيبوتي,جورجيا
د|boy:داود,دانيال,دحام,دليم|girl:دانة,دينا,دانية,دلال,ديمه|animal:دب,دجاجة,دولفين,دبور|object:دفتر,دبوس,دراجة,دلو,دفاية|country:الدنمارك,دومينيكا,الدومينيكان
ر|boy:راشد,رياض,راكان,ريان,رمزي,رائد|girl:ريم,رنيم,رنا,رؤى,رفيف,رشا|animal:رنة,راكون,روبيان|object:راديو,رمان,رف,رسائل,ربطة|country:روسيا,رومانيا,رواندا
س|boy:سعد,سالم,سلمان,سلطان,سامي,سهيل|girl:سارة,سلمى,سمر,سديم,سما|animal:سمكة,سلحفاة,سنجاب|object:ساعة,سرير,سكين,سلم,سجادة,سلة,سيارة|country:السعودية,سوريا,السودان,سويسرا,سنغافورة
ع|boy:عبدالله,عمر,علي,عثمان,عادل,عماد|girl:عائشة,عبير,عهد,عالية,العنود|animal:عصفور,عنكبوت,عجل,عقرب|object:عصير,عود,عقد,عدسة,علبة|country:عمان,العراق,عجمان
ف|boy:فهد,فيصل,فارس,فادي,فواز|girl:فاطمة,فريدة,فجر,فتون,فدوى|animal:فيل,فهد,فراشة,فأر|object:فنجان,فانوس,فرشاة,فستان|country:فرنسا,فلسطين,فنلندا,الفلبين,فيتنام
ك|boy:كريم,كمال,كاظم,كنان,كرم|girl:كريمة,كوثر,كلثوم|animal:كلب,كنغر,كوالا,كبش|object:كتاب,كرسي,كوب,كاميرا,كرة|country:كندا,كوريا,كينيا,كرواتيا,كوبا,كازاخستان
ل|boy:ليث,لؤي,لطفي,لقمان|girl:ليلى,لمى,لينا,لولوة,لجين,ليان|animal:لبؤة,لاما,لقلق|object:ليمون,لوحة,لعبة,لابتوب,لؤلؤ,لمبة|country:لبنان,ليبيا
م|boy:محمد,ماجد,مازن,مصطفى,مالك,مشعل,منصور|girl:مريم,منى,مها,ميس,ملك,منال,مرام|animal:ماعز,مهرة,مكاو|object:مفتاح,مرآة,مقص,مكتب,ملعقة,مظلة,مسمار,محفظة|country:مصر,المغرب,ماليزيا,موريتانيا,مدغشقر,منغوليا,مالي,المكسيك,المانيا
ن|boy:ناصر,نواف,نايف,نبيل,نديم|girl:نورة,نوف,نجلاء,نورا,ندى|animal:نمر,نسر,نعامة,نحلة,نملة|object:نظارة,نافذة,نرد|country:النمسا,نيجيريا,نيبال,النرويج,نيوزيلندا,ناميبيا
ه|boy:هشام,هاشم,هاني,هيثم|girl:هند,هدى,هيفاء,هيا,هتون|animal:هدهد,هرة,همستر|object:هاتف,هرم,هدية,هلال|country:هولندا,الهند,هنغاريا
و|boy:وليد,وسام,وائل|girl:وجدان,وداد,وسن,وعد|animal:ورل,واوي|object:وردة,وسادة,وتر,وعاء|country:الولايات المتحدة,ويلز
`;

const EN = `
A|boy:Adam,Alex,Amir,Andrew,Aaron,Ali|girl:Amina,Aisha,Anna,Alice,Amelia,Aya|animal:Ant,Antelope,Alligator,Alpaca|object:Apple,Anchor,Arrow,Album,Apron|country:Argentina,Australia,Austria,Algeria,Angola
B|boy:Bassel,Bandar,Bilal,Ben,Bruno|girl:Basma,Bayan,Bella,Brooke|animal:Bear,Bat,Bee,Buffalo,Butterfly|object:Book,Bottle,Ball,Bed,Bell,Bicycle|country:Bahrain,Brazil,Belgium,Bangladesh
C|boy:Chris,Carl,Cemal|girl:Clara,Chloe,Carmen|animal:Cat,Camel,Cow,Crab,Crow|object:Cup,Camera,Chair,Clock,Car,Coin|country:Canada,Chile,China,Cuba,Croatia
D|boy:David,Daniel,Dawood|girl:Dana,Dina,Diana,Dalia|animal:Dog,Dolphin,Deer,Duck|object:Desk,Door,Drum,Diamond|country:Denmark,Djibouti
E|boy:Elias,Emad,Ethan|girl:Emma,Ella,Emily,Esraa|animal:Eagle,Elephant,Eel|object:Envelope,Engine,Eraser|country:Egypt,Ethiopia,Estonia
F|boy:Fahad,Faisal,Faris,Felix|girl:Fatima,Farah,Fiona,Freya|animal:Fox,Frog,Falcon,Flamingo|object:Fork,Fan,Flag,Frame,Flower|country:France,Finland,Fiji
H|boy:Hamad,Hassan,Henry,Hugo|girl:Huda,Hana,Hessa,Holly|animal:Horse,Hawk,Hippo,Hyena|object:Hammer,Hat,Hook,Hose|country:Hungary
J|boy:Jaber,Jasim,Jamal,Jack,James|girl:Joud,Jana,Jawaher,Julia|animal:Jaguar,Jackal,Jellyfish|object:Jar,Jacket,Jewel,Jug|country:Japan,Jordan,Jamaica
K|boy:Karim,Khalid,Kevin,Kai|girl:Kawthar,Khadija,Kate,Kiara|animal:Koala,Kangaroo,Kitten|object:Kettle,Key,Kite,Knife|country:Kenya,Kuwait,Korea
L|boy:Laith,Leo,Lucas,Liam|girl:Layla,Lina,Lama,Luna,Leila|animal:Lion,Llama,Lobster,Leopard|object:Lamp,Lock,Lemon,Ladder,Laptop|country:Lebanon,Libya,Laos
M|boy:Majed,Mazen,Malik,Mohammed,Miles|girl:Maryam,Maha,Mona,Maya,Mira|animal:Mouse,Monkey,Moose|object:Mirror,Mug,Map,Medal,Microphone|country:Morocco,Malaysia,Mexico,Mali,Madagascar
N|boy:Nasser,Nawaf,Nabil,Noah,Nathan|girl:Noura,Nada,Nora,Nancy,Nina|animal:Newt,Narwhal,Nightingale|object:Needle,Notebook,Net,Nail|country:Norway,Nepal,Nigeria,Namibia
R|boy:Rashid,Rayan,Rakan,Ryan,Robert|girl:Reem,Rana,Rosa,Ruby|animal:Rabbit,Raven,Rhino|object:Radio,Rope,Ring,Ruler,Rocket|country:Russia,Romania,Rwanda
S|boy:Salem,Sultan,Sami,Sam,Said|girl:Sara,Salma,Sophia,Sama|animal:Shark,Snake,Sheep,Squirrel|object:Spoon,Sofa,Stamp,Shoe|country:Saudi Arabia,Spain,Sudan,Switzerland,Singapore,Syria
T|boy:Turki,Tamim,Thomas,Tariq|girl:Tala,Talia,Tina,Tessa|animal:Tiger,Turtle,Toad|object:Table,Telephone,Tent,Trophy,Train|country:Turkey,Tunisia,Thailand,Tanzania
`;

export const AR_LEX = parse(AR);
export const EN_LEX = parse(EN);

export function letterBank(locale: "ar" | "en"): Bank {
  return locale === "en" ? EN_LEX : AR_LEX;
}

export function playableLetters(locale: "ar" | "en"): string[] {
  const bank = letterBank(locale);
  return Object.keys(bank).filter((letter) => {
    const row = bank[letter];
    if (!row) return false;
    return (["boy", "girl", "animal", "object", "country"] as LetterCat[]).every((cat) => row[cat].length >= 2);
  });
}
