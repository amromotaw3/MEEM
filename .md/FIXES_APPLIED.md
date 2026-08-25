# تصحيحات وميزات جديدة - MediaVault v26.14.0

## 📱 الإصدار الجديد: v26.14.0

### 🆕 الميزات الجديدة في هذا الإصدار:

#### 1️⃣ **توسيع المسار الملاحي للجوال (Mobile Navigation)**
**المشكلة:** تطبيق الجوال كان يحتوي على 5 أزرار فقط في الـ dock، مما يخفي ميزات مهمة

**الحل:**
- ✔️ إضافة زر **Music** - للوصول المباشر إلى مكتبة الموسيقى
- ✔️ إضافة زر **Custom Lists** - للوصول السريع للقوائم المخصصة
- ✔️ إضافة زر **Floating Search** - بحث عائم مع animations احترافية

**الأزرار الجديدة (7 المجموع):**
```
1. Discover (البحث والاكتشاف)
2. My Space (الأفلام/المسلسلات/الدردشة/الموسيقى)
3. My List / Watchlist (قائمة المشاهدة)
4. Music 🎵 (NEW - الموسيقى)
5. Custom Lists 📋 (NEW - القوائم المخصصة)
6. Settings ⚙️ (الإعدادات)
7. Account 👤 (الحساب)
```

**التحسينات التقنية:**
- تحديث `mobile.css`: زيادة عرض الـ dock من 480px إلى 520px
- تصميم Floating Search Button بـ:
  - Gradient overlay (لون Indigo)
  - Glow effects و animations
  - ظهور/اختفاء ذكي (لا يظهر في شاشة البحث)

#### 2️⃣ **تحسينات CSS للـ Mobile Responsiveness**
**التغييرات:**
- ✔️ تصميم مستجيب لـ Custom List Detail View
- ✔️ تحسينات Search View على الجوال
- ✔️ Music View grid محسّن (2 columns)
- ✔️ Watchlist/Custom Lists الآن full-width على الجوال

#### 3️⃣ **بناء الإصدار الجديد (v26.14.0)**
**التحديثات:**
- ✔️ package.json: v26.13.0 → v26.14.0
- ✔️ Android build.gradle: versionCode 116 → 117
- ✔️ Android build.gradle: versionName 11.6.0 → 26.14.0

**نتائج البناء:**
- ✅ BUILD SUCCESSFUL
- 📦 APK Output: app-release.apk (5.27 MB)
- 📁 Location: android\app\release\
- ⏱️ Build Time: 1m 40s
- 🔧 Tasks: 238 (218 executed, 20 up-to-date)

---

## ✅ التصحيحات السابقة (من v26.13.0):

### تحسينات الأداء والواجهة:
1. **Glassmorphic Chat UI** - تصميم حديث مع blur effects
2. **Professional Skeleton Loaders** - للحلقات التلفزيونية
3. **Collection Poster Fix** - عرض الصور الصحيحة
4. **getTmdbIdStr Global Access** - إمكانية الوصول من كل مكان
5. **Invited Friends Display** - عرض الأصدقاء المدعوين

---

## 🧪 الاختبار والتحقق:

### ✅ اختبارات النسخة v26.14.0:
- ✅ التطبيق يبدأ بنجاح مع الحفظ المحلي
- ✅ Social presence يتعامل مع وضع البلا إنترنت بشكل صحيح
- ✅ إنشاء القوائم المخصصة يعمل بشكل صحيح
- ✅ بطاقات المجموعة الآن تعرض الصور الصحيحة
- ✅ تبديل العناصر في القوائم المخصصة لا يسبب أخطاء
- ✅ صفحات حلقات المسلسلات تعرض skeleton loaders احترافية
- ✅ الـ Dock على الجوال يعرض 7 أزرار بشكل صحيح
- ✅ أزرار الموسيقى والقوائم المخصصة تنقل بشكل صحيح
- ✅ زر البحث العائم يظهر/يختفي بشكل مناسب
- ✅ جميع عروض الجوال مستجيبة وسهلة الاستخدام
- ✅ بناء الجوال يكتمل بنجاح
- ✅ APK جاهز للنشر

---

## 📋 ملفات التغييرات الرئيسية:

| الملف | النسخة | التغييرات |
|------|--------|----------|
| `package.json` | v26.14.0 | تحديث رقم النسخة |
| `android/app/build.gradle` | versionCode 117 | versionCode + versionName |
| `src/renderer/index.html` | - | +2 dock buttons, +floating search |
| `src/renderer/css/mobile.css` | - | +100 سطر CSS جديد |
| `src/renderer/renderer.js` | - | +floating search handler |
| `android/app/release/app-release.apk` | v26.14.0 | APK النهائي (5.27 MB) |

---

## 🚀 التوزيع والنشر:

**الملف النهائي للنشر:**
- 📦 `android/app/release/app-release.apk` (5.27 MB)
- ✅ جاهز للنشر على Google Play Store
- ✅ يشمل جميع التحديثات والتحسينات

---

**آخر تحديث:** 2026-06-15  
**الإصدار:** v26.14.0  
**الحالة:** ✅ جاهز للإنتاج
[SCANNER] Scan complete: 2 movies, 3 shows from C:\Users\...\Movies
```

**للتشخيص:** افتح DevTools (`F12`) وابحث عن `[SCANNER]` في الـ console لرؤية ما يتم اكتشافه.

---

### 4️⃣ **Player Window يختفي للخلفية**
**المشكلة:** مشغّل الفيديو يختفي فجأة للخلفية مع صوت فقط.

**الحل:**
- ✔️ أضفنا logging لـ player window events في `src/main/windowManager.js`:
  - `[PLAYER] Player window ready, showing...` - عند الاستعداد
  - `[PLAYER] Hiding main window` - عند إخفاء النافذة الرئيسية
  - `[PLAYER] Player window closing` - عند الإغلاق
  - `[PLAYER] Player window closed, playerWindow = null`
  - `[PLAYER] Restoring main window` - عند استعادة النافذة الرئيسية

**للتشخيص:** ابحث عن `[PLAYER]` في debug logs لتتبع حركة النافذة.

---

## 📋 خطوات اختبار الإصلاحات:

### اختبار Sign-Out:
```
1. npm install
2. npm start
3. قم بتسجيل الدخول
4. اذهب لـ Account Settings
5. اضغط "Log Out"
6. تحقق من:
   - توقف الاتصال بـ Supabase
   - مسح البيانات المحلية تماماً
   - العودة لشاشة Login جديدة
7. ابحث في DevTools Console عن السجلات `[ACCOUNT]`
```

### اختبار Delete-Account:
```
1. اذهب إلى Account Settings
2. اضغط "Delete Account"
3. تابع رسائل الخطأ في DevTools Console
4. البحث عن `[ACCOUNT] Sending delete confirmation`
5. إذا كان خطأ، ستجد السبب في `[ACCOUNT] Delete account error:`
```

### اختبار Local Files:
```
1. اضبط مسار Library في Settings
2. أضف مجلد بأفلام/مسلسلات
3. انقر "Scan Library"
4. ابحث في DevTools Console عن `[SCANNER]` messages
5. تحقق من:
   - المسار الكامل المُفحوص
   - عدد الملفات المكتشفة
   - النتيجة النهائية (movies + shows)
```

### اختبار Player:
```
1. شغّل فيديو ما
2. راقب debug logs في main process
3. ابحث عن `[PLAYER]` messages
4. إذا اختفى للخلفية، سترى:
   - `[PLAYER] Player window closing`
   - `[PLAYER] Restoring main window`
```

---

## 📁 الملفات المُعدّلة:

- ✅ `src/main/store.js` - إضافة `clear-session` handler
- ✅ `src/renderer/preload.js` - إضافة `clearSession` API
- ✅ `src/renderer/renderer.js` - تحسين logout + delete handlers مع سجلات
- ✅ `src/main/libraryScanner.js` - إضافة logging شامل للمسح
- ✅ `src/main/windowManager.js` - إضافة logging لـ player window events

---

## 🔍 الملفات المهمة للـ Logging:

### في Supabase/Main Process:
```
%APPDATA%\MediaVault\sync-errors.log  ← مشاكل المزامنة مع السحابة
```

### في DevTools Console (F12):
```
[ACCOUNT] ...  ← مشاكل Sign-Out/Delete-Account
[SCANNER] ...  ← مشاكل اكتشاف الملفات المحلية
[PLAYER]  ...  ← مشاكل نافذة المشغّل
```

---

## ⚠️ ملاحظات مهمة:

1. **الملفات المحلية لن تظهر إذا:**
   - المسار غير موجود أو لا يمكن الوصول إليه
   - لا توجد ملفات فيديو بـ extensions صحيحة (.mp4, .mkv, etc)
   - البحث في النافذة متوقف (حاول refresh الصفحة)

2. **Delete-Account قد يفشل إذا:**
   - لم تكن مُسجّل دخول (تحقق من `appData.user`)
   - كان هناك مشكلة RLS في Supabase (تحقق من sync-errors.log)
   - انقطع الاتصال بالإنترنت

3. **Player قد يختفي إذا:**
   - تم إغلاق النافذة بواسطة النظام
   - تضارب في window management events
   - مشكلة في Electron window lifecycle

---

**التاريخ:** 2026-06-03 ٠٠:١٣
**الإصدار:** v12.4.0
**الحالة:** جاهز للاختبار ✅
