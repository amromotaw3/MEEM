# سجل التعديلات والإصلاحات — MediaVault

**التاريخ:** 2026-06-25 — الساعة 04:47 (+03)
**النطاق:** إصلاح مشاكل Supabase/SQL، التسجيل والدخول، التخزين والهوية على أندرويد، مشغّل الفيديو، وتنظيف عام.

> ملاحظة: تعديلات الكود تمّ التحقق منها بـ `node --check` ونجاح كل اختبارات Jest (33/33).
> تعديلات قاعدة البيانات طُبِّقت فعليًا على مشروع Supabase (`MDV`) وانعكست كملفات migration.

---

## 1) المصادقة — التسجيل والدخول (ويندوز + أندرويد)

- **إصلاح "مش بيسجّل دخول بعد إنشاء الحساب":**
  - كان التسجيل يستخدم `client.auth.signUp()` (ينشئ في `auth.users` فقط)، بينما الدخول يستخدم `handle_secure_login` الذي يبحث في `users_accounts` ببكربت → الحساب لا يُوجد عند الدخول.
  - الآن التسجيل يستخدم `cloudRegister` → `handle_register` (نفس نظام الدخول، `users_accounts` + bcrypt).
  - الملف: `src/renderer/modules/auth.js` (`handleAuthRegister`).
- **تسجيل تفاصيل الأخطاء:** عند فشل الدخول/التسجيل تُطبع `details` (السبب الفعلي من `SQLERRM`) في الكونسول لتسهيل التشخيص.

## 2) أندرويد — التخزين وهوية الجهاز

- **توحيد التخزين** في `src/renderer/js/bridge.js`: الترتيب أصبح `@capacitor/preferences` → `localStorage` → الذاكرة، بدل ما كان يفشل صامتًا على أندرويد.
- **تثبيت الهارد وير آي دي:** كان يُولّد UUID عشوائيًا في كل استدعاء (لعدم الحفظ) → كل دخول = جهاز جديد → `DEVICE_LIMIT_REACHED` وفقدان الجلسة. الآن مخزَّن ومُخبَّأ (cached).
- **إضافة الإضافات:** `@capacitor/device` و`@capacitor/preferences` في `package.json`.

## 3) مشغّل الفيديو

- **استعادة التشغيل التلقائي للحلقة التالية / الخروج عند النهاية:** `PlayerEngine` أصبح يُطلق حدث `'ended'` (كان مسجَّلًا له مستمع لكنه لا يُطلَق أبدًا). الملف: `src/renderer/renderer.js`.
- **حارس `findLibraryItemForPlayback`:** كانت دالة غير معرّفة تسبب `ReferenceError` وتوقف التشغيل → أصبحت محميّة بـ `typeof`.
- **إصلاح `queryOverride` ReferenceError** في تبديل/إطفاء الترجمة المُدارة. الملف: `src/renderer/modules/player.js`.
- **إضافة `engine.url`** (كان يُقرأ ولا يُكتب أبدًا → ميزة الصور المصغّرة على الشريط كانت ميتة).
- **إصلاح تسريب ذاكرة الترجمات:** عمل `URL.revokeObjectURL` لروابط `blob:` عند إزالة عناصر `<track>`.

## 4) Supabase / SQL (مطبّق على القاعدة + ملفات migration)

ملفات الـ migration الجديدة تحت `supabase/migrations/`:

- `20260625000000_fix_collab_rpc_caller_id.sql`
  - استعادة البحث بالإيميل في `search_collaborators` (كان بالاسم فقط).
  - `get_user_id_by_email` أصبح يحلّ من `users_accounts` أولًا ثم `auth.users`.
  - إضافة `SET search_path = public` لـ 5 دوال (تحذير `function_search_path_mutable`).
  - إندكسات لمفاتيح أجنبية غير مُفهرسة (`account_profiles`, `collection_messages`, `list_members`).
- `20260625001000_rls_perf_wrap_auth_uid.sql`
  - لفّ `auth.uid()`/`auth.role()` داخل `(select …)` في 32 سياسة RLS → تقييم مرة واحدة لكل استعلام (`auth_rls_initplan`: 33 → 0).
- `20260625002000_rls_consolidate_permissive.sql`
  - دمج السياسات المكررة الآمنة (admin أو المالك) على `user_devices` و`users_accounts` + إصلاح `media_content` (`multiple_permissive_policies`: 21 → 7).
- `20260625003000_functions_baseline.sql`
  - لقطة baseline لكل الدوال (33) من القاعدة الفعلية لمنع انحراف أي deploy/reset مستقبلي.

**حالة الـ advisors بعد التعديل:** لا أخطاء بمستوى ERROR؛ `auth_rls_initplan = 0`؛ `function_search_path_mutable = 0`.

## 5) تنظيف عام

- حذف مسار OTP/تأكيد-الإيميل الخاص بالتسجيل (أصبح ميتًا بعد توحيد التسجيل) — فورم + `otpForm.onsubmit` + دالة `handleAuthVerifyOtp` (~90 سطر). ميزات OTP الأخرى (إعادة كلمة المرور / تغيير الإيميل) لم تُمَس.
- `.gitignore`: إضافة `supabase/.temp/` و`.DS_Store`، وإزالة الملفات الخاصة بالجهاز من التتبّع (`supabase/.temp`, `android/.idea`).

---

## ما لم يُنفَّذ (يحتاج قرار أو هو ميزة كبيرة)

- **أندرويد يشغّل عبر تطبيق خارجي** (`com.amnis.player`) بدون استكمال تقدّم — قرار تصميمي. يُنصح بإضافة fallback (اختيار تطبيق) لو لم يكن مثبّتًا.
- **DRM/Widevine + فحص codec** — ميزة جديدة وليست إصلاحًا.

## خطوات يدوية مطلوبة

1. `npm install && npx cap sync` (لإضافات أندرويد الجديدة).
2. تدوير (rotate) توكن Supabase الشخصي المستخدَم أثناء الجلسة.
3. اختبار فعلي على ويندوز وأندرويد (تسجيل → دخول → تشغيل فيديو → نهاية الحلقة → قفل/فتح التطبيق).
