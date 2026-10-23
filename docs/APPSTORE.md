# App Store listing (draft)

Not submitted. TestFlight only until Krist says to submit for review.

## Basics

| Field | Value |
|---|---|
| Name | Giggles Maps |
| Subtitle (30) | Local detours that fit your time |
| Bundle ID | `com.kristpaul.gigglesmaps` |
| SKU | `gigglesmaps-ios` |
| Category | Travel (secondary: Navigation) |
| Age rating | 4+ |
| Price | Free, with in-app subscription Giggles Plus (฿59/month, `com.kristpaul.gigglesmaps.plus.monthly`) |
| Privacy policy | https://giggles-maps.pages.dev/privacy |
| Support URL | https://giggles-maps.pages.dev |
| Copyright | 2026 Krist Paul Mendoza |

## Description (EN)

Got 30 spare minutes? Spend them somewhere local.

Tell Giggles Maps where you're going and how much extra time you're happy to add. It fills that time with Sakon Nakhon's indigo cloth shops, cafés, temples and parks, with real walking or driving times, and it never goes over your limit.

• Set your extra time, from 0 to 2 hours
• Routes picked for quality and variety; at most one partner stop, always labelled
• Check in with a selfie at each stop to stamp your passport
• Collect trails: Temple Trail, Café Hopper, Indigo & Silk, City Explorer
• Free coupon spin after a check-in, with the odds shown
• Trip mode: next stop on your Lock Screen and a nudge when you arrive
• Scan a shop's QR sticker to check in instantly

Giggles Plus removes partner stops and lets you plan detours up to 4 hours.

Selfies only check that a face is in the photo; no face recognition. They are private and deleted after 30 days.

## Description (TH)

มีเวลาว่าง 30 นาที? ใช้มันกับร้านท้องถิ่นสิ

บอก Giggles Maps ว่าจะไปไหนและเพิ่มเวลาได้เท่าไร แอปจะเติมเวลานั้นด้วยร้านผ้าคราม คาเฟ่ วัด และสวนในสกลนคร พร้อมเวลาเดินหรือขับรถจริง และไม่เกินเวลาที่คุณตั้งไว้

• ตั้งเวลาเพิ่มได้ 0 ถึง 2 ชั่วโมง
• เส้นทางเลือกจากคุณภาพและความหลากหลาย มีจุดแวะพาร์ทเนอร์ไม่เกินหนึ่งจุด และติดป้ายชัดเจน
• เซลฟี่เช็คอินที่แต่ละจุดเพื่อรับตราประทับในพาสปอร์ต
• สะสมเส้นทาง: วัด คาเฟ่ ผ้าครามและไหม และสำรวจเมือง
• หมุนคูปองฟรีหลังเช็คอิน แสดงโอกาสชัดเจน
• โหมดทริป: จุดแวะถัดไปบนหน้าจอล็อก และแจ้งเตือนเมื่อถึง
• สแกนสติกเกอร์ QR ของร้านเพื่อเช็คอินทันที

Giggles Plus ไม่มีจุดแวะพาร์ทเนอร์ และวางแผนทางแวะได้ถึง 4 ชั่วโมง

## Keywords (100)

`sakon nakhon,thailand,detour,local,travel,cafe,temple,indigo,passport,stamp,trip,walk,isan,สกลนคร`

## Review notes

- Demo flow without travelling: Plan → Find my detours → Check in at a stop marked "Example partner" → turn on "I'm not in Sakon Nakhon: simulate being here", code `DEMO`, pick any photo with a face.
- Example partners are real places used as examples; they have not signed up and the app labels them.
- Sign in with Apple is offered next to Google and email (4.8). Account deletion is in Passport (5.1.1(v)) and revokes the Apple token.
- Shop payments happen only on the website (shops are businesses buying visit credit); the app sells only Giggles Plus through StoreKit.

## App Privacy answers (App Store Connect)

| Data | Collected | Linked to user | Tracking | Purpose |
|---|---|---|---|---|
| Precise location | Yes | Yes | No | App functionality |
| Photos (selfie) | Yes | Yes | No | App functionality |
| Email address | Yes (if signed in) | Yes | No | App functionality |
| User ID | Yes | Yes | No | App functionality |
| Purchase history | Yes | Yes | No | App functionality |
| Everything else | No | | | |

Matches `ios/GigglesMaps/PrivacyInfo.xcprivacy`.

## Export compliance

`ITSAppUsesNonExemptEncryption = false` (HTTPS only).

## App Store Server Notifications

Production + Sandbox server URL: `https://xrlxfvwrkowaybtkkrdl.supabase.co/functions/v1/apple-notifications` (Version 2).
