# AI Assistant hub: Sinhala and Tamil string review

The hub's Sinhala and Tamil strings were drafted by the assistant, not by a native speaker. Please have each reviewed before release, especially the capability lines (which mix product words such as PowerPoint, Excel, PDF and CTTA with translated words).

Source of truth: `frontend/src/lib/i18n.ts`. Edit the strings there; this sheet is only a review aid (regenerated from that file, 31 strings; `«name»` stands for an agent's name).

**Not covered:** the agent workspaces (chat, lot lookup, builder, deck and voice cards, notices) are English only for now. Adding them to `i18n.ts` and this sheet is the next translation step.

Words worth a deliberate choice: **agent** ("සහායක" / "உதவியாளர்"), **broker** ("තැරැව්කරු" / "தரகர்"), **by-laws** ("අතුරු නීති" / "துணைவிதிகள்"), **lot** (kept as "ලොට්" / "லாட்"), **sale-aware**, **archive**.

| Key | English | Sinhala (draft) | Tamil (draft) | Reviewed |
|---|---|---|---|---|
| `hubBreadcrumbRoot` | ASC Intelligence Hub | ASC බුද්ධි මධ්‍යස්ථානය | ASC நுண்ணறிவு மையம் | ☐ |
| `hubSub` | Ask anything, or pick a specialist for one job. | ඕනෑම දෙයක් අහන්න, නැතහොත් එක් කාර්යයක් සඳහා විශේෂඥයෙකු තෝරන්න. | எதையும் கேளுங்கள், அல்லது ஒரு வேலைக்கு நிபுணரைத் தேர்ந்தெடுங்கள். | ☐ |
| `hubStartHere` | Start here | මෙතැනින් අරඹන්න | இங்கிருந்து தொடங்குங்கள் | ☐ |
| `hubAgentLabel` | Agent 01 | සහායක 01 | உதவியாளர் 01 | ☐ |
| `hubOpenAgent` | Open the «name» agent | «name» සහායකයා විවෘත කරන්න | «name» உதவியாளரைத் திறக்கவும் | ☐ |
| `hubNoSale` | No sale selected | විකිණීමක් තෝරා නැත | விற்பனை தேர்ந்தெடுக்கப்படவில்லை | ☐ |
| `hubLangLabel` | Interface language | අතුරුමුහුණත් භාෂාව | இடைமுக மொழி | ☐ |
| `hubAllAgents` | All agents | සියලු සහායකයන් | அனைத்து உதவியாளர்கள் | ☐ |
| `hubOpening` | Opening the «name» agent… | «name» සහායකයා විවෘත කරමින්… | «name» உதவியாளரைத் திறக்கிறது… | ☐ |
| `hubOpenClassic` | Open classic chat | සම්භාව්‍ය සංවාදය විවෘත කරන්න | கிளாசிக் அரட்டையைத் திறக்கவும் | ☐ |
| `agentGeneral` | General | සාමාන්‍ය | பொது | ☐ |
| `agentAuction` | Auction | වෙන්දේසි | ஏலம் | ☐ |
| `agentAnalytics` | Analytics | විශ්ලේෂණ | பகுப்பாய்வு | ☐ |
| `agentReports` | Reports | වාර්තා | அறிக்கைகள் | ☐ |
| `agentGeneralPurpose` | Ask anything about the platform, the sale or the by-laws. | වේදිකාව, විකිණීම හෝ අතුරු නීති ගැන ඕනෑම දෙයක් අහන්න. | தளம், விற்பனை அல்லது துணைவிதிகள் பற்றி எதையும் கேளுங்கள். | ☐ |
| `agentGeneralCaps` | Ask anything · Voice chat · CTTA by-laws knowledge base · Sale-aware | ඕනෑම දෙයක් අහන්න · හඬ සංවාදය · CTTA අතුරු නීති දැනුම් පදනම · වෙන්දේසිය දන්නා | எதையும் கேளுங்கள் · குரல் உரையாடல் · CTTA துணைவிதிகள் அறிவுத்தளம் · ஏலம் அறிந்தது | ☐ |
| `agentAuctionPurpose` | Look up lots, valuations and prices for the sale. | වෙන්දේසිය සඳහා ලොට්, තක්සේරු සහ මිල සොයන්න. | ஏலத்திற்கான லாட்டுகள், மதிப்பீடுகள் மற்றும் விலைகளைத் தேடுங்கள். | ☐ |
| `agentAuctionCaps` | Lot lookup · Grade and broker prices · Sale-aware | ලොට් සෙවීම · ශ්‍රේණි සහ තැරැව්කරු මිල · වෙන්දේසිය දන්නා | லாட் தேடல் · தரம் மற்றும் தரகர் விலைகள் · ஏலம் அறிந்தது | ☐ |
| `agentAnalyticsPurpose` | Compare brokers, grades and 13 years of trends. | තැරැව්කරුවන්, ශ්‍රේණි සහ වසර 13ක ප්‍රවණතා සසඳන්න. | தரகர்கள், தரங்கள் மற்றும் 13 ஆண்டு போக்குகளை ஒப்பிடுங்கள். | ☐ |
| `agentAnalyticsCaps` | Drill-down charts · Pinned insights · Explain this chart | ගැඹුරට යන ප්‍රස්තාර · ඇමිණූ අවබෝධ · මේ ප්‍රස්තාරය පහදන්න | ஆழமாகச் செல்லும் விளக்கப்படங்கள் · பின் செய்த நுண்ணறிவுகள் · இந்த விளக்கப்படத்தை விளக்கு | ☐ |
| `agentReportsPurpose` | Build a report or deck, then export it. | වාර්තාවක් හෝ ඉදිරිපත්කිරීමක් සාදා නිර්යාත කරන්න. | அறிக்கை அல்லது விளக்கக்காட்சியை உருவாக்கி ஏற்றுமதி செய்யுங்கள். | ☐ |
| `agentReportsCaps` | Custom reports · PowerPoint · Excel · PDF · Voice | අභිරුචි වාර්තා · PowerPoint · Excel · PDF · හඬ | தனிப்பயன் அறிக்கைகள் · PowerPoint · Excel · PDF · குரல் | ☐ |
| `hubAskTitle` | Ask anything | ඕනෑම දෙයක් අහන්න | எதையும் கேளுங்கள் | ☐ |
| `hubAskHint` | General answers across the whole platform. Need one specific job done? Choose a specialist below. | සාමාන්‍ය සහායකයා මුළු වේදිකාවම ආවරණය කරයි. නිශ්චිත කාර්යයක් සඳහා විශේෂඥයෙකු අවශ්‍යද? පහතින් තෝරන්න. | பொது உதவியாளர் முழு தளத்தையும் உள்ளடக்குகிறது. ஒரு குறிப்பிட்ட வேலைக்கு நிபுணர் வேண்டுமா? கீழே தேர்ந்தெடுங்கள். | ☐ |
| `hubAskPlaceholder` | Ask about a lot, a broker, a sale or a by-law… | ලොට් එකක්, තැරැව්කරුවෙකු, විකිණීමක් හෝ අතුරු නීතියක් ගැන අහන්න… | லாட், தரகர், விற்பனை அல்லது துணைவிதி பற்றி கேளுங்கள்… | ☐ |
| `hubAskLabel` | Your question | ඔබේ ප්‍රශ්නය | உங்கள் கேள்வி | ☐ |
| `hubAskSend` | Ask | අහන්න | கேளுங்கள் | ☐ |
| `hubSpecialists` | Or choose a specialist for one job | නැතහොත් එක් කාර්යයක් සඳහා විශේෂඥයෙකු තෝරන්න | அல்லது ஒரு வேலைக்கு நிபுணரைத் தேர்ந்தெடுங்கள் | ☐ |
| `hubPrompt1` | Summarise this week's sale | මෙම සතියේ විකිණීම සාරාංශ කරන්න | இந்த வாரத்தின் விற்பனையைச் சுருக்குங்கள் | ☐ |
| `hubPrompt2` | Which broker performed best? | වඩාත්ම හොඳින් ක්‍රියා කළ තැරැව්කරු කවුද? | எந்த தரகர் சிறப்பாகச் செயல்பட்டார்? | ☐ |
| `hubPrompt3` | Explain a CTTA by-law | CTTA අතුරු නීතියක් පහදන්න | CTTA துணைவிதியை விளக்குங்கள் | ☐ |
