# Codna GitHub Pages

## بنية الملفات

- `index.html`: هيكل الصفحة وروابط الملفات.
- `css/styles.css`: تنسيقات الموقع.
- `js/firebase-config.js`: إعداد Firebase العام وApp Check Site Key.
- `js/app.js`: منطق التطبيق والمصادقة وApp Check والنشر.
- `firebase/`: قواعد Realtime Database وCloud Function للنشر.

## إعداد App Check

افتح `js/firebase-config.js` واستبدل قيمة `appCheckSiteKey` بمفتاح Site Key العام من Firebase Console → Security → App Check → Fraud Defense. لا تضع Secret Key أو Service Account Key.

استخدم هذه النطاقات في Authentication وApp Check:

```text
msdyahya.github.io
lilyvez.blogspot.com
```

## GitHub Pages

ارفع محتويات هذا المجلد إلى مستودع GitHub، واجعل Pages يعمل من branch `main` ومجلد root. رابط الموقع:

```text
https://msdyahya.github.io/codan/
```

## Firebase CLI للقواعد والوظيفة

```bash
cd firebase/functions
npm install
cd ../..
firebase deploy --only database
firebase deploy --only functions:publishPost
```

بعد رفع الكود واختباره، راقب App Check Metrics ثم فعّل Enforcement.
