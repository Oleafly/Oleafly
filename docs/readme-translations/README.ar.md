<div align="center">

<img src="https://cdn.oleafly.com/brand/logo/png/oleafly-tile-gradient-256.png" alt="شعار Oleafly" width="112" height="112" />

# Oleafly <sup><em>beta</em></sup>

[Deutsch](README.de.md) | [English](../../README.md) | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [中文](README.zh.md) | **العربية**

**بيئة بحثية متكاملة، أُعيد تصميمها لعصر الذكاء الاصطناعي.**

اكتب النصوص وجمّعها، ودقّق اللغة، وابحث في الأوراق العلمية، وأدر المراجع، وأنشئ الرسوم، وراجع ملفات PDF، وتتبّع التغييرات عبر Git. يمكنك استخدام نموذج ذكاء اصطناعي مستضاف، أو نقطة اتصال مخصصة، أو نموذج محلي عبر Ollama، أو العمل من دون ذكاء اصطناعي. يحفظ Oleafly مشاريعك في مجلدات عادية على جهازك.

[![Open issues](https://img.shields.io/github/issues/Oleafly/Oleafly?label=issues&color=22c55e)](https://github.com/Oleafly/Oleafly/issues) [![Download](https://img.shields.io/github/v/release/Oleafly/Oleafly?label=Download&color=22c55e)](https://github.com/Oleafly/Oleafly/releases/latest) [![Downloads](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FOleafly%2FOleafly%2Fbadges%2F.github%2Fbadges%2Fdownloads.json)](https://github.com/Oleafly/Oleafly/releases) [![CI](https://github.com/Oleafly/Oleafly/actions/workflows/release.yml/badge.svg)](https://github.com/Oleafly/Oleafly/actions/workflows/release.yml) [![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-22c55e.svg)](../../LICENSE)

[![macOS · Windows · Linux](https://img.shields.io/badge/macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-blue)](https://github.com/Oleafly/Oleafly/releases/latest) [![Stars](https://img.shields.io/github/stars/Oleafly/Oleafly?style=social)](https://github.com/Oleafly/Oleafly)

**[تنزيل Oleafly](https://github.com/Oleafly/Oleafly/releases/latest) · [قراءة وثائق المنتج](https://oleafly.com/docs/overview/) · [البناء من المصدر](../development.md)**

</div>

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/hero-editor-v0.3.10-r2.png" alt="برنامج Oleafly لتحرير ورقة بحثية حول LLaMA باستخدام LaTeX مع فتح شجرة المصدر، ومخطط المستند، وملف PDF المجمع معًا" width="100%" />
</div>

<!--
Recording placeholder: the hero image stands in until a 45–60 second workspace
walkthrough is ready. Keep the same framing and replace the hero above with
https://cdn.oleafly.com/videos/workspace-tour.webp.
-->

<div dir="rtl">


## البحث معقد بما يكفي

غالبًا ما يتوزع المستند التقني بين محرر ومُجمّع وعارض PDF وأداة للمراجع ومستودع Git ومحادثة ذكاء اصطناعي لا ترى المشروع نفسه.

يجمع تطبيق **Oleafly** المكتبي هذا العمل في مكان واحد، مع إبقاء الشفرة المصدرية قابلة للقراءة في المحررات الأخرى وأدوات سطر الأوامر. وتعمل واجهة المشروع نفسها سواء كنت تعد تقريرًا دراسيًا، أو ورقة لمجلة علمية، أو أطروحة من مئات الصفحات:

| عملك | ما يتولاه Oleafly |
| --- | --- |
| الكتابة | تحرير المصدر والتحرير المرئي، والإكمال التلقائي، والرموز، والاستشهادات، والرسوم، والجداول، وفهم شفرة المشروع كله |
| التجميع | محركات LaTeX وTypst مدمجة، وتحويل Markdown عبر Pandoc، وتحليل الأخطاء والسجلات، وتجميع دون اتصال من الحزم المخزنة |
| الفحص | معاينة سريعة لملفات PDF، وأدوات الصفحات والتكبير، وعرض صفحتين، وعكس الألوان، وSyncTeX في الاتجاهين |
| المراجعة | حفظ تلقائي، وسجل Git حقيقي، ومقارنة التغييرات، والاستعادة، والمزامنة مع GitHub |
| التسليم | فحوص التجميع والنشر وإمكانية الوصول والمراجع والخصوصية وأنظمة تتبع المتقدمين، إضافة إلى وضع القارئ وصيغ تصدير متعددة |
| المساعدة | مساعد ذكاء اصطناعي اختياري يفهم المشروع، ونماذج Ollama المحلية، والمزودون المستضافون، وعملاء MCP |

إذا كنت تفضّل دورة الكتابة والمعاينة في Overleaf، لكنك تريد إبقاء التجميع والملفات وGit واختيار النموذج على جهازك، فقد صُمم Oleafly لهذا الأسلوب. ويمكنه أيضًا أن يحل محل جانب كبير من إعداد محرر محلي وبيئة TeX وعارض PDF وعميل Git.

لا يدعم Oleafly حاليًا التحرير المتزامن لعدة مستخدمين عبر المتصفح. ويعتمد التعاون الآن على Git وGitHub.


## ما يمكنك فعله

### اكتب مع إبقاء الشفرة المصدرية في متناولك

- اعمل على مشاريع LaTeX وTypst وMarkdown، بما فيها المستندات الكبيرة متعددة الملفات والصور وملفات التضمين والمراجع.
- بدّل بين عرض الشفرة والعرض المرئي في LaTeX وMarkdown. وتظل الكتل الغنية غير المدعومة ظاهرة كمصدر قابل للتحرير بدلًا من اختفائها.
- أدرج العناوين والقوائم والروابط والاستشهادات والإحالات المرجعية والمعادلات والكسور والرسوم والجداول والرموز من شريط أدوات المحرر.
- استخدم الإكمال التلقائي للأوامر والاستشهادات والعلامات ومسارات الملفات والأوامر المائلة والنص المقترح داخل السطر.
- ابحث واستبدل النص، واطوِ الأقسام والبيئات، وفعّل اختصارات Vim، وشغّل التدقيق الإملائي والنحوي دون اتصال بالإنترنت.
- انتقل إلى التعريفات، وابحث عن الإحالات، وأعد تسمية العلامات أو مفاتيح الاستشهاد في المشروع، وعاين التعريفات عند تمرير المؤشر.

تفهرس خريطة المشروع كل قسم وعلامة ومفتاح استشهاد وبيئة، وتربطها بموضع `file:line`. لذلك يعمل التنقل وإعادة التسمية عبر المستند متعدد الملفات، لا داخل الملف المفتوح فقط.

| ![شجرة مصدر Oleafly بجانب خريطة المشروع، تسرد الأقسام والتصنيفات مع ملفها ورقم سطرها (الوضع الداكن)](https://cdn.oleafly.com/images/screenshots/desktop/project-structure.png) | ![شجرة مصدر Oleafly بجانب خريطة المشروع، تسرد الأقسام والتصنيفات مع ملفها ورقم سطرها (النمط الفاتح)](https://cdn.oleafly.com/images/screenshots/desktop/project-structure-light.png) |
| --- | --- |

تقرأ أداة اختيار الاستشهادات ملفات `.bib` في المشروع مباشرة، وتعرض مع كل مفتاح اسم المؤلف وسنة النشر والعنوان ورقم السطر الذي عُرّف فيه.

| ![اختيار مفتاح اقتباس من مدخلات BibTeX المُحللة، حيث يُظهر كل منها المؤلفين والسنة ورقم المصدر (الوضع الداكن)](https://cdn.oleafly.com/images/screenshots/desktop/citation-picker.png) | ![اختيار مفتاح اقتباس من مدخلات BibTeX المُحللة، حيث يُظهر كل منها المؤلفين والسنة ورقم المصدر (الوضع الفاتح)](https://cdn.oleafly.com/images/screenshots/desktop/citation-picker-light.png) |
| --- | --- |

يتجاهل عدّاد الكلمات الخاص بـ LaTeX وسوم التنسيق، ويحسب فقط الكلمات التي يراها القارئ.

| ![نافذة عدّ الكلمات المنبثقة التي تعرض عدد الكلمات والأحرف والأسطر للمستند المفتوح (الوضع الداكن)](https://cdn.oleafly.com/images/screenshots/desktop/word-count.png) | ![نافذة عدّ الكلمات المنبثقة التي تعرض عدد الكلمات والأحرف والأسطر للمستند المفتوح (الوضع الفاتح)](https://cdn.oleafly.com/images/screenshots/desktop/word-count-light.png) |
| --- | --- |

### جمّع المستند واقرأه دون مغادرة المشروع

- جمّع مستندات LaTeX باستخدام محرك Tectonic المدمج افتراضيًا. ويمكن لكل مشروع استخدام `latexmk` مع pdfLaTeX أو XeLaTeX أو LuaLaTeX عند الحاجة إلى بيئة TeX تقليدية.
- استخدم تثبيت MacTeX أو TeX Live أو MiKTeX أو TinyTeX الموجود على جهازك. وإذا لم توجد أي منها، فيمكن لـ Oleafly تثبيت نسخة TinyTeX مُدارة من دون صلاحيات المسؤول. استخدم بيئة TeX الخاصة بالنظام مع المشاريع الموثوقة فقط لأنها ليست معزولة بالكامل.
- جمّع مستندات Typst بالمحرك المدمج. ولا يحتاج مسار Tectonic الافتراضي إلى تثبيت TeX كامل.
- اعرض أخطاء التجميع كتقارير داخل المحرر وبطاقات مقروءة بدلًا من البحث في السجل الخام.
- اقرأ ملف PDF بجانب المصدر مع التمرير المتواصل، وعرض صفحة واحدة أو صفحتين، وأدوات الملاءمة والتنقل، ووضع ملء الشاشة، ونافذة معاينة منفصلة اختيارية.
- استخدم SyncTeX في الاتجاهين: انتقل من المصدر إلى ملف PDF، أو انقر مع Cmd/Ctrl على نص PDF للعودة إلى السطر المقابل.
- احفظ ملف PDF في المشروع أو صدّر المصدر كأرشيف محمول.

| ![صفحة إعدادات محرك LaTeX التي تعرض المحركات المدمجة وخياراتها (الوضع الداكن)](https://cdn.oleafly.com/images/screenshots/desktop/settings-latex-engine.png) | ![صفحة إعدادات محرك LaTeX التي تعرض المحركات المدمجة وخياراتها (الوضع الفاتح)](https://cdn.oleafly.com/images/screenshots/desktop/settings-latex-engine-light.png) |
| --- | --- |

صغّر المعاينة لرؤية المستند كله على الشاشة. هذه طريقة سريعة للتحقق من مواضع الجداول والرسوم والعناصر العائمة.

| ![مستند من ثلاث صفحات مُنسق في المعاينة مع إظهار كل شكل وجدول (الوضع الداكن)](https://cdn.oleafly.com/images/screenshots/desktop/pdf-preview-spread.png) | ![مستند من ثلاث صفحات مُنسق في المعاينة مع إظهار كل شكل وجدول (الوضع الفاتح)](https://cdn.oleafly.com/images/screenshots/desktop/pdf-preview-spread-light.png) |
| --- | --- |

### احتفظ بسجل يمكنك مراجعته

كل مشروع هو مستودع Git حقيقي. ينشئ Oleafly نقاط حفظ بعد نجاح التجميع وبعد فترات توقف التحرير، ثم يعرض الأجزاء المهمة من هذا السجل داخل التطبيق.

- راجع الخط الزمني لنقاط الحفظ وقارن الفروقات جنبًا إلى جنب.
- استعد نسخة أقدم من ملف من دون استبدال بقية المشروع.
- جهّز التغييرات أو ألغها، وأنشئ نقاط الحفظ، وادفعها أو اسحبها من لوحة التحكم بالمصدر.
- انشر مشروعًا على GitHub أو اربطه بمستودع موجود.
- واصل العمل من الطرفية أو من محرر آخر؛ فلا توجد صيغة مستند خاصة تحتاج إلى فكها.

![مقارنة جنبًا إلى جنب بين نسختين من المصدر في سجل Git داخل Oleafly](https://cdn.oleafly.com/images/screenshots/desktop/git-diff.png)

### ابدأ بقالب مناسب

يضم معرض المشاريع قوالب قابلة للتحرير للأوراق والأطروحات والتقارير والكتب والعروض والملصقات والواجبات والخطابات والمراجع والسير الذاتية والمخططات. ويمكن تصفيتها حسب محرك المستند أو دعم العمل دون اتصال أو التوافق مع أنظمة تتبع المتقدمين. ولا تُنزّل حزم القوالب والخطوط الاختيارية إلا عند اختيارها.


| ![معرض قوالب المشاريع القابل للبحث في Oleafly مع صور مصغرة مباشرة، وعدد الفئات، وفلاتر المحرك (الوضع الداكن)](https://cdn.oleafly.com/images/screenshots/desktop/project-templates.png) | ![معرض قوالب المشاريع القابل للبحث في Oleafly مع صور مصغرة مباشرة، وعدد الفئات، وفلاتر المحرك (الوضع الفاتح)](https://cdn.oleafly.com/images/screenshots/desktop/project-templates-light.png) |
| --- | --- |

### تنقّل بين مهام البحث والنشر

- أضف استشهادًا بالبحث عن DOI أو معرّف arXiv أو رابط أو عنوان. ينشئ Oleafly مدخل BibTeX من دون تكرار ويدرجه عند المؤشر.
- ارسم مخططًا على لوحة مرئية أو عدّل شفرة TikZ مباشرة، ثم أدرجه كمصدر متجهي أو صورة. ويمكن إعادة فتح شفرة TikZ المحفوظة وتعديلها.
- استورد مستندات Word عبر Pandoc، أو أعد بناء مشروع LaTeX قابل للتحرير من ملف PDF محليًا، أو استورد ملف ZIP لمشروع Overleaf، أو حوّل صورة معادلة إلى نص باستخدام نموذج رؤية.
- صدّر ملفات PDF وأرشيفات المصدر، إضافة إلى Word وHTML وMarkdown والنص وPowerPoint وEPUB عندما يدعمها محرك المستند ونوع المشروع.
- تصفّح مواعيد المؤتمرات واستخدم البحث الاختياري في الأدبيات من دون تحويل مجلد المشروع إلى مستند سحابي.

يبحث Oleafly في arXiv وSemantic Scholar وCrossref وPubMed وOpenAlex وGoogle Scholar معًا، ويدمج السجلات المكررة، ويحفظ النتائج التي تختارها أو يصدّرها بصيغة BibTeX. ويمكنه أيضًا فحص المستند المفتوح فقرةً فقرة واقتراح استشهادات للادعاءات التي لا تملك مصدرًا بعد.

| ![بحث عن الاستشهادات يُعيد نتائج مُزالة التكرارات من عدة فهارس، كل منها مزود بإجراء حفظ ونسخ BibTeX (الوضع الداكن)](https://cdn.oleafly.com/images/screenshots/desktop/literature-search.png) | ![بحث عن الاستشهادات يُعيد نتائج مُزالة التكرارات من عدة فهارس، كل منها مزود بإجراء حفظ ونسخ BibTeX (الوضع الفاتح)](https://cdn.oleafly.com/images/screenshots/desktop/literature-search-light.png) |
| --- | --- |


يتيح لك مُنشئ المخططات الرسم على لوحة مرئية وتجميع شفرة TikZ بجانبها، بحيث يظل الشكل المدرج مصدرًا متجهيًا قابلًا للتحرير.

| ![مُنشئ المخططات مع بنية المحولات على اللوحة ومعاينة TikZ المُجمّعة بجانبها (الوضع الداكن)](https://cdn.oleafly.com/images/screenshots/desktop/diagram-composer.png) | ![مُنشئ المخططات مع بنية المحولات على اللوحة ومعاينة TikZ المُجمّعة بجانبها (الوضع الفاتح)](https://cdn.oleafly.com/images/screenshots/desktop/diagram-composer-light.png) |
| --- | --- |

### افحص المستند قبل إرساله

يفحص Preflight المشروع كاملًا، وأحدث سجل للتجميع، وملف PDF الناتج. وتغطي فحوصه الستة مشكلات التجميع والتخطيط، ومتطلبات المؤتمرات والمجلات، وتحليل أنظمة تتبع المتقدمين، وإمكانية الوصول، والمراجع والأصول، وخصوصية التحكيم الأعمى. وتوضح النتائج ما تم التحقق منه داخل المستند وما يحتاج إلى مراجعة الكاتب.

يفتح وضع القارئ النص المستخرج من ملف PDF صفحةً صفحة، بصورة قريبة مما يستلمه قارئ الشاشة أو المحلل الآلي. يقدم Preflight إرشادات عملية قبل التسليم، ولا يضمن القبول ولا يُعد شهادة رسمية لإمكانية الوصول.

| ![تقرير ما قبل الرحلة عن درجة إمكانية الوصول مع مصدر محدد ونتائج المخرجات المجمعة (الوضع الداكن)](https://cdn.oleafly.com/images/screenshots/desktop/preflight-ats.png) | ![تقرير ما قبل الرحلة عن درجة إمكانية الوصول مع مصدر محدد ونتائج المخرجات المجمعة (الوضع الفاتح)](https://cdn.oleafly.com/images/screenshots/desktop/preflight-ats-light.png) |
| --- | --- |

للمراجع والاستشهادات لوحة خاصة تعرض قائمة المراجع وكل استشهاد مستخدم في المستند والرموز المعرّفة في المشروع.

| ![لوحة المراجع التي تعرض مداخل قائمة المراجع حسب المفتاح والسنة بجانب المصدر وملف PDF المجمع (الوضع الداكن)](https://cdn.oleafly.com/images/screenshots/desktop/references-panel.png) | ![لوحة المراجع التي تعرض مداخل قائمة المراجع حسب المفتاح والسنة بجانب المصدر وملف PDF المجمع (الوضع الفاتح)](https://cdn.oleafly.com/images/screenshots/desktop/references-panel-light.png) |
| --- | --- |

### دع الذكاء الاصطناعي يعمل على المشروع، إذا أردت

يمكن للمساعد قراءة الملفات وتعديلها، والبحث في المشروع، وتشغيل التجميع، وفحص السجل، واستخراج نص PDF للتحقق من النتيجة. ويمكنه أيضًا المساعدة في الاستشهادات والمستندات المستوردة وأشكال TikZ القابلة للتحرير.

أنت تختار النموذج:

- اربط مزودًا مستضافًا مدعومًا باستخدام مفتاح API الخاص بك.
- شغّل نموذجًا محليًا عبر Ollama.
- اترك الذكاء الاصطناعي من دون إعداد واستخدم بقية التطبيق كالمعتاد.

| ![لوحة المساعد التي تقدم نقاط بداية مثل العثور على أوراق بحثية للاستشهاد بها، وكتابة مراجعة أدبية، وتصحيح أخطاء المصادر (الوضع الداكن)](https://cdn.oleafly.com/images/screenshots/desktop/ai-assistant-start.png) | ![لوحة المساعد التي تقدم نقاط بداية مثل العثور على أوراق بحثية للاستشهاد بها، وكتابة مراجعة أدبية، وتصحيح أخطاء المصادر (الوضع الفاتح)](https://cdn.oleafly.com/images/screenshots/desktop/ai-assistant-start-light.png) |
| --- | --- |

تظهر تغييرات الملفات مع مقارنة وخياري الموافقة والرفض. ويمكن لخيار «السماح دائمًا» الموافقة على عمليات الكتابة العادية خلال الجلسة الحالية، بينما يظل الحذف بحاجة إلى تأكيد.

![تغيير ملف مساعد معروض كفرق باللونين الأحمر والأخضر مع عناصر تحكم الرفض، والسماح دائمًا، والموافقة](https://cdn.oleafly.com/images/screenshots/desktop/ai-approval-diff.png)

بعد الموافقة، يُطبق التعديل على الملف ويُعاد تجميع المستند. ويظل خيار «استعادة الشفرة إلى ما قبل هذه الاستجابة» متاحًا لكل استجابة.

![تعديل وافق عليه المستخدم وطُبق على المستند ثم ظهر في ملف PDF بعد إعادة تجميعه](https://cdn.oleafly.com/images/screenshots/desktop/ai-chat-applied.png)

تُضبط إعدادات المزودين من صفحة الإعدادات. تُشفّر المفاتيح على القرص محليًا وتعالجها واجهة Rust الخلفية، لذلك لا تصل إلى واجهة العرض. ولا ترسل الطلبات المستضافة المفتاح إلا إلى المزود المحدد، بينما لا يحتاج نموذج Ollama المحلي إلى مفتاح سحابي.

| ![صفحة إعدادات مساعد الذكاء الاصطناعي مع عدة مزودين متصلين واختيار نموذج Ollama محلي (الوضع الداكن)](https://cdn.oleafly.com/images/screenshots/desktop/settings-ai.png) | ![صفحة إعدادات مساعد الذكاء الاصطناعي مع عدة مزودين متصلين واختيار نموذج Ollama محلي (الوضع الفاتح)](https://cdn.oleafly.com/images/screenshots/desktop/settings-ai-light.png) |
| --- | --- |

يمكن لـ Oleafly إتاحة أدوات المشروع لتطبيقات Claude Desktop وClaude Code وCursor وCodex وعملاء MCP الآخرين. يعمل الخادم على `localhost` ويدعم وضع القراءة فقط وثلاث سياسات للموافقة. ويمكن لأدوات الملفات الأصلية مواصلة العمل بعد إغلاق آخر نافذة عندما تسمح السياسة المحددة بذلك. وتظل مقيدة بآخر مشروع أبلغ عنه التطبيق ولا تختار مشروعًا آخر من المكتبة بناءً على حداثته.

| ![إعدادات MCP التي تعرض الخادم المحلي وتعليمات العميل وسياسات الموافقة المتاحة (الوضع الداكن)](https://cdn.oleafly.com/images/screenshots/desktop/settings-mcp.png) | ![إعدادات MCP التي تعرض الخادم المحلي وتعليمات العميل وسياسات الموافقة المتاحة (الوضع الفاتح)](https://cdn.oleafly.com/images/screenshots/desktop/settings-mcp-light.png) |
| --- | --- |

يمكن الاطلاع على تفاصيل النماذج الأمنية والمزودين عبر [مرجع الميزات](../features.md) و[إعداد MCP](../mcp.md).

يمكن الوصول إلى الأدوات من مكان واحد: يبحث الشريط الشامل في المشاريع والمستندات، ويتحول إلى لوحة أوامر عند كتابة `/`.

| ![قائمة أوامر شريط البحث والمشاريع التي تم تحديثها مؤخرًا (الوضع الداكن)](https://cdn.oleafly.com/images/screenshots/desktop/search-omnibar.png) | ![قائمة أوامر شريط البحث والمشاريع التي تم تحديثها مؤخرًا (الوضع الفاتح)](https://cdn.oleafly.com/images/screenshots/desktop/search-omnibar-light.png) |
| --- | --- |

## محلي أولًا، بحدود شبكة واضحة

لا يتطلب التطبيق حسابًا ولا يجمع بيانات القياس عن بُعد. وتظل بيانات المشروع الأساسية على جهازك.

| يعمل أو يظل محلياً                        | يستخدم الشبكة فقط عندما تطلب ذلك                    |
| ----------------------------------------- | --------------------------------------------------- |
| ملفات المشروع وذاكرة المحرر المؤقتة       | الربط بنماذج الذكاء الاصطناعي السحابية التي تختارها |
| مستودعات Git وسجل التعديلات               | عمليات الدفع والسحب والنشر عبر GitHub               |
| بناء الملفات عبر الحزم المخزنة مسبقاً     | تنزيل حزم TeX الضرورية للتجميع المبدئي              |
| توليد ملفات PDF واستخراج النصوص           | جلب القوالب، الخطوط، أو أدوات مثل Pandoc وTinyTeX   |
| الفحص النحوي والتدقيق اللغوي الأولي       | استيراد الاقتباسات، تفقد المؤتمرات، وجلب التحديثات  |
| نماذج الذكاء الاصطناعي المحلية عبر Ollama | —                                                   |

تُحفظ مفاتيح API محليًا. وتظل ملفات المستندات العادية قابلة للاستخدام حتى إذا توقفت عن استخدام Oleafly.

## قريبًا

تبقي خارطة الطريق Oleafly مفتوحًا ومحليًا أولًا، وتوسّع استخدامه في مراحل العمل البحثي.

- ترجمة واجهة Oleafly إلى مزيد من اللغات.
- إضافة مهارات ووظائف إضافية للوكلاء لمسارات عمل مركزة وقابلة لإعادة الاستخدام، مع تقليل تكرار السياق واستهلاك الرموز.
- إنشاء وكلاء بحث يحولون سؤالًا ومجموعة مصادر إلى مسودة أولية منظمة.
- دعم التعاون والتعليقات في الوقت الفعلي، مع استضافة ذاتية لفرق البحث.
- توفير حزمة خفيفة وقابلة للتثبيت لواجهة سطر الأوامر، للاستخدامات التي لا تحتاج إلى واجهة رسومية.
- توسيع أدوات التحرير والمعاينة والنشر لمستندات Typst وMarkdown.
- ربط Mendeley ومزيد من خدمات المراجع والمكتبات والبحث.
- مزامنة المشاريع بين أجهزتك عبر خدمة مستضافة ذاتيًا، مع تحسين مزامنة GitHub الاختيارية.

## التثبيت

حمّل أحدث إصدار من [إصدارات GitHub](https://github.com/Oleafly/Oleafly/releases/latest).

| المنصة | ملف التثبيت |
| --- | --- |
| macOS, Apple Silicon | `.dmg` |
| Windows, x86_64 | `.msi` أو `-setup.exe` |
| Linux, x86_64 | `.AppImage` أو `.deb` |
| Linux, ARM64 | `.AppImage` أو `.deb` |

تتطلب حزم Linux توفر glibc 2.39 أو إصداراً أحدث.

قد تقوم أول عملية تجميع لـ LaTeX بتنزيل الحزم التي يتطلبها المستند. يقوم Tectonic بتخزينها مؤقتاً لعمليات البناء القادمة، بينما يقصر وضع عدم الاتصال (Offline mode) التجميع على هذه الذاكرة المؤقتة فقط.

للتشغيل مباشرة من الكود المصدري:

```bash
git clone https://github.com/Oleafly/Oleafly.git
cd Oleafly
pnpm install

host_target="$(rustc -vV | sed -n 's/^host: //p')"

./scripts/fetch-tectonic.sh "$host_target"
./scripts/fetch-biber.sh "$host_target"
./scripts/fetch-typst.sh "$host_target"

pnpm tauri dev
```


راجع [دليل التطوير](../development.md) لمعرفة المتطلبات الأساسية، وإعداد المنصات، وبناء حزم الإنتاج، وتشغيل واجهة سطر الأوامر من المصدر.

تنزّل هذه البرامج النصية أدوات المترجم الجانبية المثبتة ببصماتها الرقمية والمناسبة لمنصتك الحالية، وتضعها في `src-tauri/binaries`.

يُستخدم المعامل `all` في التكامل المستمر وبناء الإصدارات، حيث يجب تجهيز جميع المنصات المدعومة.

يظل تفعيل مزايا الإكمال الذكي للمحرر عبر خادمي `TexLab` و`Tinymist` اختياريًا في بيئة التطوير المحلية. ويمكنك جلب خوادم اللغات باستخدام `pnpm language-servers:fetch`.

تشرح وثيقة [سلسلة أدوات خوادم اللغات](../language-server-toolchain.md) سياسات السلامة والترخيص والتوزيع.

### واجهة سطر الأوامر (CLI)

تتيح لك أداة `oleaflyc` إدارة مشاريع **Oleafly** مباشرة دون الحاجة لفتح تطبيق سطح المكتب. يتم بناء الأداة آنيًا من الكود المصدري داخل هذا المستودع، إذ لم تُطرح بعد كحزمة برمجية مستقلة.

```bash
cargo run -p oleafly-cli --bin oleaflyc -- init
cargo run -p oleafly-cli --bin oleaflyc -- doctor
cargo run -p oleafly-cli --bin oleaflyc -- build
cargo run -p oleafly-cli --bin oleaflyc -- watch
cargo run -p oleafly-cli --bin oleaflyc -- project info --json
```

_ملاحظة:_ تُنفّذ الأوامر نسبةً إلى المسار الحالي، وللعمل على مشروع في مسار مغاير، يُرجى إلحاق الخيار `-C` بالأمر.

نفّذ `oleaflyc --help` لاستعراض القائمة الكاملة للأوامر والخيارات.

## مراجع المطورين

توجد أدلة الاستخدام العامة في [وثائق منتج Oleafly](https://oleafly.com/docs/overview/). أما المراجع أدناه فهي للمساهمين ومطوري التكامل ومسؤولي الإصدارات.

|المرجع|الموضوع|
|---|---|
|[فهرس الهندسة التقنية](../README.md)|جرد الميزات والمواصفات الهندسية|
|[مرجع الميزات](../features.md)|إمكانيات المنتج ومسارات العمل المدعومة|
|[محركات المستندات](../document-engines.md)|إمكانيات LaTeX وTypst وMarkdown|
|[معمارية المنتج](../architecture.md)|حدود النظام، وهيكلية الحزم، ونقاط التوسعة|
|[التطوير](../development.md)|الإعداد المحلي، والاختبارات، وسير عمل المساهمة|
|[سلسلة أدوات خوادم اللغات](../language-server-toolchain.md)|سياسات الجلب، والتحقق من السلامة، والتوزيع|
|[تكامل MCP](../mcp.md)|العملاء الخارجيون، ورموز الوصول، وسياسات التحقق|
|[إطلاق الإصدارات](../releasing.md)|خطوات بناء الإصدارات وفحص المخرجات|
|[توقيع الشيفرة البرمجية](../signing.md)|متطلبات توقيع التطبيقات للمنصات المختلفة|
|[التحديثات التلقائية](../updates.md)|ملفات التحديث، والتواقيع الرقمية، وخيارات التراجع|

## المساهمة

<table>
  <tr>
    <td width="38%" valign="top">
      <img src="../assets/oleafly-club.png" alt="نادي Oleafly، مجتمع بحثي مفتوح المصدر يحتفي بالمسودات والمراجعات والاختبارات وعمليات التسليم الناجحة" width="100%" />
    </td>
    <td width="62%" valign="top">
      <h3>يستحق الباحثون أدوات يمكنهم فحصها وتوسيعها والثقة بها.</h3>
      <p>يُطوّر <a href="https://github.com/prajwal-svm">Prajwal Murthy</a> والمساهمون Oleafly علنًا. نرحب بتقارير الأخطاء والإصلاحات والقوالب والتوثيق والملاحظات الدقيقة حول المنتج.</p>
    </td>
  </tr>
</table>

1. اقرأ ملف [CONTRIBUTING.md](../../CONTRIBUTING.md).
2. افتح تقرير مشكلة قبل بدء تغيير كبير. ويمكن إرسال الإصلاحات الصغيرة والمحددة مباشرة في طلب سحب.
3. شغّل الفحوصات المناسبة قبل إرسال المساهمة:

   ```bash
   pnpm build
   pnpm test
   cargo test --workspace --all-targets
   ```

أبلغ عن المشكلات الأمنية بشكل خاص وفق [SECURITY.md](../../SECURITY.md). وتخضع المشاركة لـ [ميثاق السلوك](../../CODE_OF_CONDUCT.md).

## المجتمع والدعم

- اطرح الأسئلة وشارك الأفكار واطلب مسارات عمل عبر [GitHub Discussions](https://github.com/Oleafly/Oleafly/discussions).
- أبلغ عن الأخطاء واطلب الميزات عبر [GitHub Issues](https://github.com/Oleafly/Oleafly/issues).
- تابع [@OleaflyHQ على X](https://x.com/OleaflyHQ) لمعرفة أخبار المنتج والإصدارات.

إذا أفادك Oleafly، يمكنك [منح المستودع نجمة](https://github.com/Oleafly/Oleafly). يساعد ذلك باحثين آخرين على العثور على المشروع ويدعم استمرار تطويره.

## سجل النجوم (Star History)

<a href="https://www.star-history.com/?repos=Oleafly%2FOleafly&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&theme=dark&legend=top-left&sealed_token=aHz2JA-SBvmD73PyT7aCcCqMyAUvCPtidSAAvsQQxR8-1xdB-RZ-oXHKRnqIJUfSICl6Dd3_XPcHgb5Menvk_FfalfMb1GRbJC_TdeTMBVDi3jVUIXBBdovZ4dufhj4JWF3UXptJhw8pGmB6lqQ-X7gDOWu_bkPTQ7k-Q0VeBiq_jNgwRb7RSMgrSb-P" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&legend=top-left&sealed_token=aHz2JA-SBvmD73PyT7aCcCqMyAUvCPtidSAAvsQQxR8-1xdB-RZ-oXHKRnqIJUfSICl6Dd3_XPcHgb5Menvk_FfalfMb1GRbJC_TdeTMBVDi3jVUIXBBdovZ4dufhj4JWF3UXptJhw8pGmB6lqQ-X7gDOWu_bkPTQ7k-Q0VeBiq_jNgwRb7RSMgrSb-P" />
   <img alt="مخطط سجل النجوم" src="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&legend=top-left&sealed_token=aHz2JA-SBvmD73PyT7aCcCqMyAUvCPtidSAAvsQQxR8-1xdB-RZ-oXHKRnqIJUfSICl6Dd3_XPcHgb5Menvk_FfalfMb1GRbJC_TdeTMBVDi3jVUIXBBdovZ4dufhj4JWF3UXptJhw8pGmB6lqQ-X7gDOWu_bkPTQ7k-Q0VeBiq_jNgwRb7RSMgrSb-P" />
 </picture>
</a>

## شكر وتقدير

يعتمد Oleafly في بنائه على جهود مشاريع مفتوحة المصدر:

[Tauri](https://tauri.app/)، [React](https://react.dev/)، [CodeMirror](https://codemirror.net/)، [Tectonic](https://tectonic-typesetting.github.io/)، [Typst](https://typst.app/)، [pdf.js](https://mozilla.github.io/pdf.js/)، [Zustand](https://github.com/pmndrs/zustand)، [Tailwind CSS](https://tailwindcss.com/)، [Harper](https://writewithharper.com/)، و
[Hunspell](https://hunspell.github.io/).

يخضع Oleafly لترخيص [AGPL-3.0-or-later](../../LICENSE). وتتوفر إشعارات الأطراف الخارجية في ملف [THIRD_PARTY_LICENSES.md](../../THIRD_PARTY_LICENSES.md).

</div>
