// Which bare domains X turns into links, so a draft reads the way its post will.
//
// A post goes out through twitter-text: "x11.social" or "cursor.com/cli" become
// t.co links (and so [link] for the model) even without the https:// prefix, while
// "readme.md" or "x.ai" stay text. The composer holds the typed draft, so it
// has to make the same call. The rules follow twitter-text 3's
// extractUrlsWithIndices with extractUrlsWithoutProtocol. The top-level domains
// are the public suffix list's single-label names, split into two-letter
// country codes and the rest, the way twitter-text splits them.
// The lists were taken from psl 1.15.0 (data/rules.js): every single-label ASCII rule.
// Those names come from the Public Suffix List (publicsuffix.org),
// which is licensed under MPL-2.0; the two lists below are used under that
// licence. The rest of this file is MIT like the project.

const GENERIC_TLDS = new Set((
  "aaa|aarp|abb|abbott|abbvie|abc|able|abogado|abudhabi|academy|accenture|accountant|accountants|aco|actor|ads|" +
  "adult|aeg|aero|aetna|afl|africa|agakhan|agency|aig|airbus|airforce|airtel|akdn|alibaba|alipay|allfinanz|" +
  "allstate|ally|alsace|alstom|amazon|americanexpress|americanfamily|amex|amfam|amica|amsterdam|analytics|android|" +
  "anquan|anz|aol|apartments|app|apple|aquarelle|arab|aramco|archi|army|art|arte|asda|asia|associates|athleta|" +
  "attorney|auction|audi|audible|audio|auspost|author|auto|autos|aws|axa|azure|baby|baidu|banamex|band|bank|bar|" +
  "barcelona|barclaycard|barclays|barefoot|bargains|baseball|basketball|bauhaus|bayern|bbc|bbt|bbva|bcg|bcn|beats|" +
  "beauty|beer|bentley|berlin|best|bestbuy|bet|bharti|bible|bid|bike|bing|bingo|bio|biz|black|blackfriday|" +
  "blockbuster|blog|bloomberg|blue|bms|bmw|bnpparibas|boats|boehringer|bofa|bom|bond|boo|book|booking|bosch|" +
  "bostik|boston|bot|boutique|box|bradesco|bridgestone|broadway|broker|brother|brussels|build|builders|business|" +
  "buy|buzz|bzh|cab|cafe|cal|call|calvinklein|cam|camera|camp|canon|capetown|capital|capitalone|car|caravan|cards|" +
  "care|career|careers|cars|casa|case|cash|casino|cat|catering|catholic|cba|cbn|cbre|center|ceo|cern|cfa|cfd|" +
  "chanel|channel|charity|chase|chat|cheap|chintai|christmas|chrome|church|cipriani|circle|cisco|citadel|citi|" +
  "citic|city|claims|cleaning|click|clinic|clinique|clothing|cloud|club|clubmed|coach|codes|coffee|college|" +
  "cologne|com|commbank|community|company|compare|computer|comsec|condos|construction|consulting|contact|" +
  "contractors|cooking|cool|coop|corsica|country|coupon|coupons|courses|cpa|credit|creditcard|creditunion|cricket|" +
  "crown|crs|cruise|cruises|cuisinella|cymru|cyou|dad|dance|data|date|dating|datsun|day|dclk|dds|deal|dealer|" +
  "deals|degree|delivery|dell|deloitte|delta|democrat|dental|dentist|desi|design|dev|dhl|diamonds|diet|digital|" +
  "direct|directory|discount|discover|dish|diy|dnp|docs|doctor|dog|domains|dot|download|drive|dtv|dubai|dunlop|" +
  "dupont|durban|dvag|dvr|earth|eat|eco|edeka|edu|education|email|emerck|energy|engineer|engineering|enterprises|" +
  "epson|equipment|ericsson|erni|esq|estate|eurovision|eus|events|exchange|expert|exposed|express|extraspace|fage|" +
  "fail|fairwinds|faith|family|fan|fans|farm|farmers|fashion|fast|fedex|feedback|ferrari|ferrero|fidelity|fido|" +
  "film|final|finance|financial|fire|firestone|firmdale|fish|fishing|fit|fitness|flickr|flights|flir|florist|" +
  "flowers|fly|foo|food|football|ford|forex|forsale|forum|foundation|fox|free|fresenius|frl|frogans|frontier|ftr|" +
  "fujitsu|fun|fund|furniture|futbol|fyi|gal|gallery|gallo|gallup|game|games|gap|garden|gay|gbiz|gdn|gea|gent|" +
  "genting|george|ggee|gift|gifts|gives|giving|glass|gle|global|globo|gmail|gmbh|gmo|gmx|godaddy|gold|goldpoint|" +
  "golf|goo|goodyear|goog|google|gop|got|gov|grainger|graphics|gratis|green|gripe|grocery|group|gucci|guge|guide|" +
  "guitars|guru|hair|hamburg|hangout|haus|hbo|hdfc|hdfcbank|health|healthcare|help|helsinki|here|hermes|hiphop|" +
  "hisamitsu|hitachi|hiv|hkt|hockey|holdings|holiday|homedepot|homegoods|homes|homesense|honda|horse|hospital|" +
  "host|hosting|hot|hotels|hotmail|house|how|hsbc|hughes|hyatt|hyundai|ibm|icbc|ice|icu|ieee|ifm|ikano|imamat|" +
  "imdb|immo|immobilien|inc|industries|infiniti|info|ing|ink|institute|insurance|insure|int|international|intuit|" +
  "investments|ipiranga|irish|ismaili|ist|istanbul|itau|itv|jaguar|java|jcb|jeep|jetzt|jewelry|jio|jll|jmp|jnj|" +
  "jobs|joburg|jot|joy|jpmorgan|jprs|juegos|juniper|kaufen|kddi|kerryhotels|kerrylogistics|kerryproperties|kfh|" +
  "kia|kids|kim|kindle|kitchen|kiwi|koeln|komatsu|kosher|kpmg|kpn|krd|kred|kuokgroup|kyoto|lacaixa|lamborghini|" +
  "lamer|lancaster|land|landrover|lanxess|lasalle|lat|latino|latrobe|law|lawyer|lds|lease|leclerc|lefrak|legal|" +
  "lego|lexus|lgbt|lidl|life|lifeinsurance|lifestyle|lighting|like|lilly|limited|limo|lincoln|link|lipsy|live|" +
  "living|llc|llp|loan|loans|locker|locus|lol|london|lotte|lotto|love|lpl|lplfinancial|ltd|ltda|lundbeck|luxe|" +
  "luxury|madrid|maif|maison|makeup|man|management|mango|map|market|marketing|markets|marriott|marshalls|mattel|" +
  "mba|mckinsey|med|media|meet|melbourne|meme|memorial|men|menu|merck|merckmsd|miami|microsoft|mil|mini|mint|mit|" +
  "mitsubishi|mlb|mls|mma|mobi|mobile|moda|moe|moi|mom|monash|money|monster|mormon|mortgage|moscow|moto|" +
  "motorcycles|mov|movie|msd|mtn|mtr|museum|music|nab|nagoya|name|navy|nba|nec|net|netbank|netflix|network|" +
  "neustar|new|news|next|nextdirect|nexus|nfl|ngo|nhk|nico|nike|nikon|ninja|nissan|nissay|nokia|norton|now|nowruz|" +
  "nowtv|nra|nrw|ntt|nyc|obi|observer|office|okinawa|olayan|olayangroup|ollo|omega|one|ong|onl|online|ooo|open|" +
  "oracle|orange|org|organic|origins|osaka|otsuka|ott|ovh|page|panasonic|paris|pars|partners|parts|party|pay|pccw|" +
  "pet|pfizer|pharmacy|phd|philips|phone|photo|photography|photos|physio|pics|pictet|pictures|pid|pin|ping|pink|" +
  "pioneer|pizza|place|play|playstation|plumbing|plus|pnc|pohl|poker|politie|porn|post|pramerica|praxi|press|" +
  "prime|pro|prod|productions|prof|progressive|promo|properties|property|protection|pru|prudential|pub|pwc|qpon|" +
  "quebec|quest|racing|radio|read|realestate|realtor|realty|recipes|red|redstone|redumbrella|rehab|reise|reisen|" +
  "reit|reliance|ren|rent|rentals|repair|report|republican|rest|restaurant|review|reviews|rexroth|rich|richardli|" +
  "ricoh|ril|rio|rip|rocks|rodeo|rogers|room|rsvp|rugby|ruhr|run|rwe|ryukyu|saarland|safe|safety|sakura|sale|" +
  "salon|samsclub|samsung|sandvik|sandvikcoromant|sanofi|sap|sarl|sas|save|saxo|sbi|sbs|scb|schaeffler|schmidt|" +
  "scholarships|school|schule|schwarz|science|scot|search|seat|secure|security|seek|select|sener|services|seven|" +
  "sew|sex|sexy|sfr|shangrila|sharp|shell|shia|shiksha|shoes|shop|shopping|shouji|show|silk|sina|singles|site|ski|" +
  "skin|sky|skype|sling|smart|smile|sncf|soccer|social|softbank|software|sohu|solar|solutions|song|sony|soy|spa|" +
  "space|sport|spot|srl|stada|staples|star|statebank|statefarm|stc|stcgroup|stockholm|storage|store|stream|studio|" +
  "study|style|sucks|supplies|supply|support|surf|surgery|suzuki|swatch|swiss|sydney|systems|tab|taipei|talk|" +
  "taobao|target|tatamotors|tatar|tattoo|tax|taxi|tci|tdk|team|tech|technology|tel|temasek|tennis|teva|thd|" +
  "theater|theatre|tiaa|tickets|tienda|tips|tires|tirol|tjmaxx|tjx|tkmaxx|tmall|today|tokyo|tools|top|toray|" +
  "toshiba|total|tours|town|toyota|toys|trade|trading|training|travel|travelers|travelersinsurance|trust|trv|tube|" +
  "tui|tunes|tushu|tvs|ubank|ubs|unicom|university|uno|uol|ups|vacations|vana|vanguard|vegas|ventures|verisign|" +
  "versicherung|vet|viajes|video|vig|viking|villas|vin|vip|virgin|visa|vision|viva|vivo|vlaanderen|vodka|volvo|" +
  "vote|voting|voto|voyage|wales|walmart|walter|wang|wanggou|watch|watches|weather|weatherchannel|webcam|weber|" +
  "website|wed|wedding|weibo|weir|whoswho|wien|wiki|williamhill|win|windows|wine|winners|wme|wolterskluwer|" +
  "woodside|work|works|world|wow|wtc|wtf|xbox|xerox|xihuan|xin|xxx|xyz|yachts|yahoo|yamaxun|yandex|yodobashi|yoga|" +
  "yokohama|you|youtube|yun|zappos|zara|zero|zip|zone|zuerich"
).split("|"))

const COUNTRY_TLDS = new Set((
  "ac|ad|ae|af|ag|ai|al|am|ao|aq|ar|as|at|au|aw|ax|az|ba|bb|be|bf|bg|bh|bi|bj|bm|bn|bo|br|bs|bt|bv|bw|by|bz|ca|cc|" +
  "cd|cf|cg|ch|ci|cl|cm|cn|co|cr|cu|cv|cw|cx|cy|cz|de|dj|dk|dm|do|dz|ec|ee|eg|es|et|eu|fi|fj|fm|fo|fr|ga|gb|gd|ge|" +
  "gf|gg|gh|gi|gl|gm|gn|gp|gq|gr|gs|gt|gu|gw|gy|hk|hm|hn|hr|ht|hu|id|ie|il|im|in|io|iq|ir|is|it|je|jo|jp|ke|kg|ki|" +
  "km|kn|kp|kr|kw|ky|kz|la|lb|lc|li|lk|lr|ls|lt|lu|lv|ly|ma|mc|md|me|mg|mh|mk|ml|mn|mo|mp|mq|mr|ms|mt|mu|mv|mw|mx|" +
  "my|mz|na|nc|ne|nf|ng|ni|nl|no|nr|nu|nz|om|pa|pe|pf|ph|pk|pl|pm|pn|pr|ps|pt|pw|py|qa|re|ro|rs|ru|rw|sa|sb|sc|sd|" +
  "se|sg|sh|si|sj|sk|sl|sm|sn|so|sr|ss|st|su|sv|sx|sy|sz|tc|td|tf|tg|th|tj|tk|tl|tm|tn|to|tr|tt|tv|tw|tz|ua|ug|uk|" +
  "us|uy|uz|va|vc|ve|vg|vi|vn|vu|wf|ws|ye|yt|zm|zw"
).split("|"))

// A domain glued to a letter, digit, @, $ or # is part of a word, an email, a
// cashtag or a hashtag; after - _ . / it is part of something longer.
const DOMAIN_RUN_PATTERN = /(?<![A-Za-z0-9@＠$#＃\u202A-\u202E\-_./])[a-z0-9\u00c0-\u024f\u1e00-\u1eff-]+(?:\.[a-z0-9\u00c0-\u024f\u1e00-\u1eff-]+)+/giu
const SCHEME_URL_PATTERN = /https?:\/\/\S+|www\.\S+/giu
const TLD_SHAPE_PATTERN = /^(?:[a-z]{2,}|xn--[a-z0-9-]+)$/iu
const GLUED_AFTER_TLD_PATTERN = /[0-9a-z@+-]/iu
const PATH_AFTER_DOMAIN_PATTERN = /^(?::\d+)?\//u

/** How much of a dotted run X links: the longest prefix that ends in a known top-level domain, or none. */
const linkedDomainLength = (text: string, offset: number, run: string): number => {
  const labels = run.split(".")
  for (let count = labels.length; count >= 2; count -= 1) {
    const tld = (labels[count - 1] ?? "").toLowerCase()
    if (!TLD_SHAPE_PATTERN.test(tld)) continue
    const domain = labels.slice(0, count).join(".")
    if (GLUED_AFTER_TLD_PATTERN.test(text[offset + domain.length] ?? "")) continue
    const generic = tld.startsWith("xn--") || GENERIC_TLDS.has(tld)
    if (!generic && !COUNTRY_TLDS.has(tld)) continue
    // One label under a country code ("x.ai", "main.py") is a link only with a path, or under .co and .tv.
    const shortCountryDomain = !generic && count === 2 && tld !== "co" && tld !== "tv"
    if (shortCountryDomain && !PATH_AFTER_DOMAIN_PATTERN.test(text.slice(offset + domain.length))) return 0
    return domain.length
  }
  return 0
}

/**
 * The draft with https:// in front of every URL X will link without one. Only
 * the scheme is added: the contract's own URL rule then turns each into [link]
 * and takes trailing punctuation with it, as it did on the API text in training.
 */
export const markXAutolinks = (text: string): string => {
  const schemeSpans: Array<readonly [number, number]> = []
  for (const match of text.matchAll(SCHEME_URL_PATTERN)) {
    schemeSpans.push([match.index, match.index + match[0].length])
  }
  const insideSchemeUrl = (index: number) => schemeSpans.some(([start, end]) => index >= start && index < end)
  return text.replace(DOMAIN_RUN_PATTERN, (run: string, offset: number) => {
    if (insideSchemeUrl(offset) || linkedDomainLength(text, offset, run) === 0) return run
    return `https://${run}`
  })
}
