<div align="center">

<img src="https://cdn.oleafly.com/brand/logo/png/oleafly-tile-gradient-256.png" alt="Oleafly logo" width="112" height="112" />

# Oleafly <sup><em>beta</em></sup>

[Deutsch](docs/readme-translations/README.de.md) | [English](../../README.md) | [Español](docs/readme-translations/README.es.md) | [Français](docs/readme-translations/README.fr.md) | [日本語](docs/readme-translations/README.ja.md) | [한국어](docs/readme-translations/README.ko.md) | [Português](docs/readme-translations/README.pt.md) | [Русский](docs/readme-translations/README.ru.md) | [中文](docs/readme-translations/README.zh.md) | **العربية**

**بيئة بحثية متكاملة، أُعيدت هندستها لعصر الذكاء الاصطناعي (AI).**

من تحرير النصوص وتجميعها برمجياً (Compile)، مروراً بالتدقيق اللغوي والبحث في الأوراق الأكاديمية، وصولاً إلى إدارة المراجع، و إنشاث الرسوم التوضيحية، ومراجعة ملفات PDF، وتتبّع مسار التعديلات بدقة عبر Git؛ يمنحك Oleafly بيئة عمل متكاملة وشاملة. يمكنك من توظّيف الذكاء الاصطناعي بالأسلوب الذي يناسبك: سواءً عبر النماذج المستضافة سحابياً، أو نقاط الربط المخصصة (Custom Endpoints)، أو محلياً باستخدام Ollama، أو بالاعتماد كلياً على أدواتك التقليدية دون ذكاء اصطناعي، مع الاحتفاظ بكامل مشاريعك ومستنداتك بأمان داخل مجلداتك المحلية المعتادة على جهازك.

[![Open issues](https://img.shields.io/github/issues/Oleafly/Oleafly?label=issues&color=22c55e)](https://github.com/Oleafly/Oleafly/issues) [![Download](https://img.shields.io/github/v/release/Oleafly/Oleafly?label=Download&color=22c55e)](https://github.com/Oleafly/Oleafly/releases/latest) [![Downloads](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FOleafly%2FOleafly%2Fbadges%2F.github%2Fbadges%2Fdownloads.json)](https://github.com/Oleafly/Oleafly/releases) [![CI](https://github.com/Oleafly/Oleafly/actions/workflows/release.yml/badge.svg)](https://github.com/Oleafly/Oleafly/actions/workflows/release.yml) [![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-22c55e.svg)](LICENSE)

[![macOS · Windows · Linux](https://img.shields.io/badge/macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-blue)](https://github.com/Oleafly/Oleafly/releases/latest) [![Stars](https://img.shields.io/github/stars/Oleafly/Oleafly?style=social)](https://github.com/Oleafly/Oleafly)

**[تنزيل Oleafly](https://github.com/Oleafly/Oleafly/releases/latest) · [قراءة وثائق المنتج](https://oleafly.com/docs/overview/) · [البناء من المصدر](docs/development.md)**

</div>

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/hero-editor-v0.3.10-r2.png" alt="Oleafly editing the LLaMA research paper in LaTeX with the source tree, document outline, and compiled PDF open together" width="100%" />
</div>

<!--
Recording placeholder: the hero image stands in until a 45–60 second workspace
walkthrough is ready. Keep the same framing and replace the hero above with
https://cdn.oleafly.com/videos/workspace-tour.webp.
-->

<div dir="rtl">


## يكفي البحث العلمي ما يكتنفه من تعقيد وتشتت

كثيرًا ما يجد الباحث نفسه موزعًا بين أدواتٍ شتى؛ محرر نصوص هنا، ومصرّف برمجيات (Compiler) هناك، وعارض لملفات PDF، وأداة لفرز المراجع، ومستودع Git، ومساعد ذكاء اصطناعي معزول لا يدرك سياق العمل.

يأتي تطبيق **Oleafly** المكتبي ليجمع هذا الشتات في بيئة متكاملة واحدة، مع الاحتفاظ بمرونة الشفرة المصدرية وإتاحة قراءتها عبر مختلف المحررات وأسطر الأوامر (Command Line). ويتكيف النظام بمرونة متناهية سواء أكنت تعد تقريرًا دراسيًا، أو ورقة علمية لمجلة محكّمة، أو أطروحة تمتد لمئات الصفحات:

| العمل                      | ما يتولاه Oleafly                                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| التحرير و التدوين (Write)  | كتابة الشفرة المصدرية والتحرير المرئي (Visual Editing) السلس، مع الإكمال التلقائي، وإدراج الرموز، والاستشهادات المرجعية(Citations)، والمخططات، والجداول، فضلاً عن الذكاء البرمجي الشامل للمشروع. |
| البناء والترجمة (Compile)  | محركات LaTeX وTypst مدمجة، وتحويل مستندات Markdown عبر Pandoc، وتحليل السجلات والأخطاء، مع توفير نسخ مخبأة (Cached) تدعم العمل دون اتصال.                                                        |
| الفحص و المعاينة (Inspect) | استعراض فوري لملفات PDF، وتحكم مرن بالتكبير وتخطيط الصفحات المتجاورة، ووضع عكس الألوان، مع مزامنة SyncTeX ثنائية الاتجاه فائقة الدقة.                                                            |
| المراجعة و الضبط (Revise)  | حفظ تلقائي، وتتبع فعلي عبر Git مع مقارنة التغييرات (Diffs)، واستعادة الإصدارات السابقة، ومزامنة سلسة مع GitHub.                                                                                  |
| الفحص و التسليم (Submit)   | تدقيق التجميع والنشر، والتحقق من إمكانية الوصول وتوافق أنظمة المتقدمين (ATS)، وفحص الخصوصية، مع دعم وضع القراءة وخيارات التصدير المتعددة.                                                        |
| المساندة الذكية (Get Help) | مساعد ذكاء اصطناعي اختياري مدرك لكافة أبعاد المشروع(Project-Aware)، مع دعم النماذج المحلية عبر Ollama، ومزودي الخدمات السحابية، وبروتوكولات MCP.                                                 |

إن كنت تصبو إلى مرونة التحرير وسرعة المعاينة التي يألفها مستخدمو Overleaf، مع التمسك بالسيادة الكاملة على بيئتك المحلية—من تحكّم في التجميع، والملفات، ومستودعات Git، وانتقاء النماذج الذكية محليًا—فإن **Oleafly** صُمم ليكون خيارك الأمثل.

يختصر التطبيق عليك عناء التجهيز الشاق للمحررات التقليدية، وبيئات TeX، وعوارض PDF، وأدوات Git المستقلة.

> _تجدر الإشارة إلى أن Oleafly لا يدعم حاليًا التحرير التعاوني اللحظي عبر المتصفح، حيث يعتمد كليًا على منظومة Git وGitHub كمسار رسمي وموثوق للعمل الجماعي._


## **آفاق إبداعك وإمكاناتك**

**اكتب بطلاقة مع بقاء الشفرة المصدرية طوع بنانك**

- **إدارة شاملة للمشاريع:** تعامل باقتدار مع مستندات LaTeX ,Typst وMarkdown مهما بلغت ضخامتها وتعددت ملفاتها، مع إحاطة تامة بالصور، وملفات التضمين (Includes)، والمراجع الببليوغرافية.
- **مرونة التنقل بين الأنماط:** بدّل بسلاسة بين عرض الشفرة (Code) والعرض المرئي التفاعلي (Visual) لمحررات LaTeX وMarkdown؛ مع ضمان بقاء العناصر البرمجية المتقدمة قابلة للتحرير والتعديل بدلاً من حجبها.
- **إدراج فوري وغني:** أضف العناوين، والقوائم، والروابط، والاستشهادات، والإحالات المرجعية (Cross-References)، والمعادلات الرياضية، والكسور، والرسوم البيانية، والجداول، والرموز بلمسة واحدة من شريط الأدوات.
- **إكمال تلقائي ذكي:** استعن بمقترحات ذكية للأوامر، والاستشهادات، والعلامات التعريفية، ومسارات الملفات، وأوامر الشرطة المائلة، والتلميحات النصية الاستباقية أثناء الكتابة (Inline Ghost Text).
- **أدوات تحرير متقدمة:** استفد من خاصيتي البحث والاستبدال، وطي الأقسام والبيئات البرمجية (Environments)، ودعم اختصارات Vim، إلى جانب تدقيق لغوي ونحوي متكامل يعمل دون الحاجة إلى اتصال بالإنترنت.
- **تنقل وإدارة دقيقة للمراجع:** انتقل مباشرة إلى التعريفات(Jump to Definitions)، وتتبع الإحالات، وأعد تسمية المفاتيح والعلامات على امتداد المشروع ككل، مع إمكانية المعاينة السريعة بمجرد تمرير الفأرة  (Hover).

تتولى **خريطة المشروع** (Project Map) فهرسة كل قسم، وعلامة، ومفتاح استشهاد، وبيئة عمل بدقة متناهية عبر عنونتها المباشرة بنظام `file:line`؛ مما يمنحك تجربة سلسة في التنقل وإعادة التسمية عبر كافة ملفات المشروع كوحدة واحدة متكاملة.

| ![Oleafly's source tree beside the project map, listing sections and labels with their file and line (dark theme)](https://cdn.oleafly.com/images/screenshots/desktop/project-structure.png) | ![Oleafly's source tree beside the project map, listing sections and labels with their file and line (light theme)](https://cdn.oleafly.com/images/screenshots/desktop/project-structure-light.png) |
| --- | --- |

**إدارة دقيقة للمراجع:** تتيح لك أداة الاستشهادات (Citation picker) استعراض ملفات `.bib` مباشرةً وبسلاسة تامة؛ حيث تعرض مفاتيح الاقتباس مقرونةً باسم المؤلف، وسنة النشر، والعنوان، ورقم سطر التعريف بدقة.

| ![Choosing a citation key from parsed BibTeX entries, each showing authors, year, and source line (dark theme)](https://cdn.oleafly.com/images/screenshots/desktop/citation-picker.png) | ![Choosing a citation key from parsed BibTeX entries, each showing authors, year, and source line (light theme)](https://cdn.oleafly.com/images/screenshots/desktop/citation-picker-light.png) |
| --- | --- |

**إحصاء ذكي للنصوص:** يتجاهل عدّاد الكلمات المخصص لـ LaTeX وسوم الشيفرة البرمجية والتنسيقات الجانبية، ليحصر تركيزه فقط على الكلمات الفعلية الظاهرة للقارئ.

| ![The word count popover reporting words, characters, and lines for the open document (dark theme)](https://cdn.oleafly.com/images/screenshots/desktop/word-count.png) | ![The word count popover reporting words, characters, and lines for the open document (light theme)](https://cdn.oleafly.com/images/screenshots/desktop/word-count-light.png) |
| --- | --- |

### **بيئة متكاملة للإنشاء و القراءة دون مغادرة مساحة العمل**

- **محركات بناء متعددة ومرنة:** يمكنك ترجمة مستندات LaTeX بالاعتماد المباشر على محرك Tectonic المدمج تلقائيًا، أو التحول عند الحاجة إلى بيئات TeX التقليدية عبر `latexmk` بمحركات مثل pdfLaTeX أو XeLaTeX أو LuaLaTeX؛
- **إدارة تلقائية للبيئات:** يتكامل المحرر مع بيئات MacTeX أو TeX Live أو MiKTeX أو TinyTeX المكتشفة على جهازك. وفي حال غيابها، يوفر Oleafly بيئة TinyTeX مُدارة ذاتيًا ودون اشتراط صلاحيات المسؤول؛
- **أمان الحوسبة وعزل الملفات:** يُنصح بقصر استخدام بيئة TeX الخاصة بالنظام على المشاريع الموثوقة فقط، نظرًا لعدم توفر عزل أمني كامل (Sandbox)؛
- **دعم أصيل لمستندات Typst:** يتيح المحرك المدمج ترجمة مستندات Typst فورًا، دون تكبّد عناء تثبيت حزم TeX الكاملة؛
- **تشخيص فوري وجليّ للأخطاء:** استبدل مشقة التنقيب في ملفات السجلات الصامتة (Raw logs) بتشخيصات دقيقة وبطاقات أخطاء مقروءة تظهر مباشرةً داخل محررك البرمجي؛
- **معاينة بصرية متقدمة لملفات PDF:** تصفّح النتيجة جنبًا إلى جنب مع الشيفرة المصدرية، مع تجربة تمرير انسيابي، وعرض متكيف للصفحات الفردية أو المزدوجة، فضلًا عن إمكانية المعاينة في شاشة كاملة أو نافذة مستقلة؛
- **مزامنة تفاعلية عبر SyncTeX:** تنقّل لحظيًا بين الشيفرة وموضعها في ملف PDF؛ فبنقرة واحدة مصحوبة بزر Cmd/Ctrl تنتقل مباشرة من النتيجة المعروضة إلى سطرها البرمجي المقابل، والعكس صحيح؛
- **حفظ وتصدير سلس:** احتفظ بملفات PDF النهائية داخل مجلد عملك، أو صدّر المشروع كاملًا في هيئة أرشيف محمول ومستقل.

| ![The LaTeX Engine settings page showing the bundled engines and their options (dark theme)](https://cdn.oleafly.com/images/screenshots/desktop/settings-latex-engine.png) | ![The LaTeX Engine settings page showing the bundled engines and their options (light theme)](https://cdn.oleafly.com/images/screenshots/desktop/settings-latex-engine-light.png) |
| --- | --- |

يتيح لك تصغير مشهد العرض (Zoom out) إلقاء نظرة بانورامية شاملة على المستند؛ وهي الوسيلة الأسرع للتحقق من استقرار الجداول، والرسوم التوضيحية، والعناصر العائمة في مواضعها المحددة بدقة.

| ![A three-page document laid out in the preview with every figure and table visible (dark theme)](https://cdn.oleafly.com/images/screenshots/desktop/pdf-preview-spread.png) | ![A three-page document laid out in the preview with every figure and table visible (light theme)](https://cdn.oleafly.com/images/screenshots/desktop/pdf-preview-spread-light.png) |
| --- | --- |

### **سِجِلٌّ تاريخي متكامل، ومسار عمل لا ينقطع**

يقوم كل مشروع في الأساس على مستودع Git متكامل؛ حيث يتولى Oleafly أرشفة تعديلاتك تلقائيًا عبر نقاط حفظ (Commits) ذكية تُسجّل عقب كل تجميع ناجح أو عند سكون التحرير، مع إبراز المحطات المفصلية في واجهة التطبيق لسهولة الرجوع إليها.

- **تتبّع التغييرات بدقة:** استعرض الخط الزمني للحفظ (commit timeline)، وقارن الفروقات البرمجية جنبًا إلى جنب (side-by-side diffs) بكل وضوح.
-  **استعادة انتقائية:** استرجع أي ملف إلى حالته السابقة بمرونة، دون المساس ببقية مستندات المشروع.
- **تحكّم كامل بالإصدارات:** أدر عمليات التجهيز (Stage)، والإلغاء (Discard)، والحفظ (Commit)، والدفع (Push)، والسحب (Pull) مباشرة من لوحة التحكم Source Control.
- **تكامل سلس مع GitHub:** انشر مشروعك بنقرة واحدة أو اربطه بمستودع قائم بسلاسة تامة.
- **حرية مطلقة لأدواتك:** تابع العمل مباشرة عبر الطرفية (Terminal) أو محررك المفضل، دون قيود أو صيغ احتكارية مغلقة.

![A side-by-side source diff in Oleafly's Git history](https://cdn.oleafly.com/images/screenshots/desktop/git-diff.png)

### **انطلاقة واثقة مع قوالب مُحكَمة**

يضع معرض المشاريع بين يديك باقةً متنوعة من القوالب الجاهزة والقابلة للتخصيص الكامل؛ لتغطي شتى الاحتياجات الأكاديمية والمهنية—من الأوراق البحثية، والأطروحات، والتقارير الرصينة، إلى الكتب، والعروض التقديمية، والملصقات العلمية(posters)، والسير الذاتية، والمخططات الدقيقة.

- **تصفية ذكية:** إمكانية فرز القوالب وفق محرك المعالجة، أو إمكانية العمل دون اتصال، أو التوافق مع أنظمة تتبع المتقدمين (ATS).
    
- **مرونة التخزين:** تنزيل الخطوط وحزم القوالب اختيارياً عند الحاجة فقط، لتوفير المساحة وسرعة الأداء.
    
- **تنظيم متقدم:** دعم هيكلة المشاريع وتوزيعها عبر ملفات متعددة لإدارة المحتوى المعقد بكفاءة وسلاسة.


| ![Oleafly's searchable project template gallery with live thumbnails, category counts, and engine filters (dark theme)](https://cdn.oleafly.com/images/screenshots/desktop/project-templates.png) | ![Oleafly's searchable project template gallery with live thumbnails, category counts, and engine filters (light theme)](https://cdn.oleafly.com/images/screenshots/desktop/project-templates-light.png) |
| --- | --- |

### **تجربة متكاملة تجمع بين رصانة البحث ومرونة النشر**

- **إدارة ذكية للمراجع:** إدراج الاستشهادات بلمسة واحدة بالبحث عبر المعرف الرقمي (DOI)، أو معرف (arXiv ID)، أو الرابط، أو العنوان. يتولى النظام توليد مدخلات BibTeX نقية من التكرار وإدراجها بدقة حيث يقف مؤشرك.
- **رسم احترافي وتفاعلي:** لوحة مرئية (visual canvas) لتصميم المخططات مع إمكانية تحرير شفرات TikZ برمجياً ومباشرة، وإدراج النتائج كرسوم متجهة أو صور قابلة لإعادة الفتح والتعديل لاحقاً.
- **استيراد شامل ومتقدم:** تحويل ملفات Word بسلاسة عبر Pandoc، وإعادة بناء مشاريع LaTeX قابلة للتحرير من ملفات PDF محلياً، مع دعم استيراد أرشيفات Overleaf (ZIP)، وتحويل صور المعادلات الرياضية إلى نصوص برمجية بالاعتماد على نماذج الرؤية الحاسوبية (vision model).
- **تصدير مرن ومتعدد الصيغ:** إنتاج مستندات PDF وحزم الأكواد المصدرية، مع دعم التصدير لصيغ Word، وHTML، وMarkdown، وPowerPoint، وEPUB بحسب ما يدعمه محرك المشروع.
- **محرك استكشاف وتدقيق بحثي:** متابعة مواعيد المؤتمرات والبحث في أمهات المنصات العلمية (arXiv، وSemantic Scholar، وCrossref، وPubMed، وOpenAlex، وGoogle Scholar) في آنٍ واحد، مع دمج النتائج المتطابقة تلقائياً وتصديرها بصيغة BibTeX دون المساس بخصوصية ملفاتك المحلية.
- **فحص المراجع الذكي:** مسح دقيق للمستند فقرة تلو الأخرى لاكتشاف الادعاءات غير الموثقة واقتراح المراجع الملائمة لها لتعزيز مصداقية أبحاثك.

| ![Citation search returning deduplicated results from several indexes, each with a save and copy-BibTeX action (dark theme)](https://cdn.oleafly.com/images/screenshots/desktop/literature-search.png) | ![Citation search returning deduplicated results from several indexes, each with a save and copy-BibTeX action (light theme)](https://cdn.oleafly.com/images/screenshots/desktop/literature-search-light.png) |
| --- | --- |


يمنحك **مُنشئ المخططات (Diagram Composer)** مساحة تفاعلية تُرسم فيها الأفكار بسلاسة، لتتحول آنياً إلى كود **TikZ** برمجي دقيق؛ مما يضمن أن ما تُدرجه هو رسم متجهي أصيل يتيح لك كامل الحرية في إعادة تحريره وصقله برمجياً.

| ![The diagram composer with a transformer architecture on the canvas and its compiled TikZ preview alongside (dark theme)](https://cdn.oleafly.com/images/screenshots/desktop/diagram-composer.png) | ![The diagram composer with a transformer architecture on the canvas and its compiled TikZ preview alongside (light theme)](https://cdn.oleafly.com/images/screenshots/desktop/diagram-composer-light.png) |
| --- | --- |

### فحص شامل ومُحكم قبل النشر
تتولى أداة **الفحص المسبق (Preflight)** استقراء مشروعك بأكمله؛ فتدقق أحدث سجلات المعالجة وتفحص ملف الـ PDF النهائي عبر ستة محاور مستقلة:

- **سلامة البناء والتنسيق:** رصد أخطاء التجميع وعيوب التخطيط البصري.
- **معايير النشر الأكاديمي:** مطابقة متطلبات المجلات والمؤتمرات العلمية.
- **أنظمة الفرز الآلي (ATS):** ضمان قراءة المحتوى بسلاسة وتوافقه البرمجي.
- **إمكانية الوصول الشاملة:** تحسين جاهزية المستند للتقنيات المساعدة.
- **المراجع والوسائط:** التحقق من ارتباط الأصول والملحقات.
- **الخصوصية والنزاهة:** مواءمة معايير التحكيم الأعمى (blind review) وتجريد المستند من البيانات التعريفية.

تُميز الأداة بوضوح بين النتائج القطعية المستخلصة مباشرة والملحوظات الإرشادية التي تتطلب مراجعة الكاتب، بينما يُحاكي **نمط القارئ (Reader View)** تجربة قارئات الشاشة والأنظمة الآلية عبر عرض النص المستخرج صفحة بصفحة. تُمثل هذه الأداة مرشداً عملياً يُعينك على تحسين التسليم، وليست وثيقة قبول نهائي أو شهادة اعتماد رسمية.

| ![Preflight reporting an accessibility score with specific source and compiled-output findings (dark theme)](https://cdn.oleafly.com/images/screenshots/desktop/preflight-ats.png) | ![Preflight reporting an accessibility score with specific source and compiled-output findings (light theme)](https://cdn.oleafly.com/images/screenshots/desktop/preflight-ats-light.png) |
| --- | --- |

كما خُصصت لوحة مستقلة لإدارة المراجع والاستشهادات، تتيح استعراض المصادر (Bibliography)، وكل اقتباس مُدرج، والرموز المعرّفة في بنية المشروع.

| ![The references panel listing bibliography entries by key and year beside the source and compiled PDF (dark theme)](https://cdn.oleafly.com/images/screenshots/desktop/references-panel.png) | ![The references panel listing bibliography entries by key and year beside the source and compiled PDF (light theme)](https://cdn.oleafly.com/images/screenshots/desktop/references-panel-light.png) |
| --- | --- |

### ذكاء اصطناعي مرن في خدمة مشروعك

يعمل المساعد الذكي جنباً إلى جنب مع خطوات عملك؛ فيقرأ الملفات ويُجري التعديلات، ويبحث داخل المشروع، ويُشغل التجميع مع تدقيق سجلات الأخطاء، فضلاً عن استخراج نصوص PDF للتحقق الذاتي من الدقة وتنسيق الاقتباسات والمستندات وأشكال TikZ.

**حرية مطلقة في اختيار النموذج:**

- ربط مزودي الخدمات السحابية المدعومة عبر مفاتيح API الخاصة بك.
- تشغيل النماذج محلياً بخصوصية تامة عبر **Ollama**.
- العمل دون تفعيل أدوات الذكاء الاصطناعي مع التمتع بكامل مزايا المنصة كالمعتاد.

| ![The assistant panel offering starting points such as finding papers to cite, writing a literature review, and fixing source errors (dark theme)](https://cdn.oleafly.com/images/screenshots/desktop/ai-assistant-start.png) | ![The assistant panel offering starting points such as finding papers to cite, writing a literature review, and fixing source errors (light theme)](https://cdn.oleafly.com/images/screenshots/desktop/ai-assistant-start-light.png) |
| --- | --- |

تُعرض التعديلات المقترحة بفروقات لونية واضحة تتيح لك حرية **القبول** أو **الرفض**. يتيح لك خيار **«السماح دائماً»** الموافقة التلقائية على عمليات الكتابة الروتينية أثناء الجلسة الحالية، مع الإبقاء على طلب التأكيد اليدوي الصارم لأي إجراء يتضمن الحذف.

![An assistant file change shown as a red and green diff with Reject, Always allow, and Approve controls](https://cdn.oleafly.com/images/screenshots/desktop/ai-approval-diff.png)

فور اعتمادك للتعديل، يُدمج في الملف ويُعاد تجميع المستند في الحال، مع توفير خيار دائم يتيح لك **«استعادة الكود إلى حالته السابقة»**(Restore code to before this response) بضغطة زر.

![An approved assistant edit applied to the document and reflected in the recompiled PDF](https://cdn.oleafly.com/images/screenshots/desktop/ai-chat-applied.png)

تُدار خيارات المزودين بدقة عبر صفحة الإعدادات؛ حيث تُشفّر المفاتيح محلياً على القرص وتُعالج عبر واجهة Rust الخلفية بمعزل تام عن واجهة العرض (Webview). تُوجّه الطلبات السحابية المفاتيح للمزود المعني حصراً، بينما تعمل النماذج المحلية كلياً دون الحاجة لأي مفاتيح خارجية.

| ![The AI Assistant settings page with several providers connected and a local Ollama model selected (dark theme)](https://cdn.oleafly.com/images/screenshots/desktop/settings-ai.png) | ![The AI Assistant settings page with several providers connected and a local Ollama model selected (light theme)](https://cdn.oleafly.com/images/screenshots/desktop/settings-ai-light.png) |
| --- | --- |

يمتد توافق **Oleafly** ليتيح أدواته عبر بروتوكول **MCP** لتطبيقات مثل Claude Desktop وClaude Code وCursor وCodex، معتمداً على خادم محلي (`localhost`) يدعم وضع القراءة فقط وثلاث سياسات متباينة للموافقة. كما تواصل الأدوات مهامها الأصلية حتى بعد إغلاق النوافذ طالما سمحت السياسة بذلك، على أن تظل مقيدة بنطاق آخر مشروع أُبلغ عنه التطبيق دون التبديل العشوائي بين المشاريع.

| ![MCP settings showing the local server, its client instructions, and the available approval policies (dark theme)](https://cdn.oleafly.com/images/screenshots/desktop/settings-mcp.png) | ![MCP settings showing the local server, its client instructions, and the available approval policies (light theme)](https://cdn.oleafly.com/images/screenshots/desktop/settings-mcp-light.png) |
| --- | --- |

يمكن الاطلاع على تفاصيل النماذج الأمنية والمزودين عبر [مرجع الميزات](docs/features.md) و[إعداد MCP](docs/mcp.md).

تلتئم هذه الأدوات جميعها في واجهة موحدة؛ حيث يتيح لك **الشريط الشامل (Omnibar)** البحث السريع داخل وثائقك ومشاريعك، وبمجرد إدخال الرمز `/` يتحول الشريط فوراً إلى **لوحة أوامر سريعة**(command palette) تضع كامل التحكم بين يديك.

| ![The omnibar listing commands and recently updated projects (dark theme)](https://cdn.oleafly.com/images/screenshots/desktop/search-omnibar.png) | ![The omnibar listing commands and recently updated projects (light theme)](https://cdn.oleafly.com/images/screenshots/desktop/search-omnibar-light.png) |
| --- | --- |

## **السيادة لبياناتك: بيئة محلية أولاً (Local-first) وبحدود شبكية منضبطة**

يعمل التطبيق دون اشتراط تسجيل حساب، ويخلو تماماً من أدوات التتبع أو جمع البيانات. تُحفظ أصول مشاريعك بالكامل داخل حاسوبك، لتظل تحت سيطرتك المطلقة..

| يعمل أو يظل محلياً                        | يستخدم الشبكة فقط عندما تطلب ذلك                    |
| ----------------------------------------- | --------------------------------------------------- |
| ملفات المشروع وذاكرة المحرر المؤقتة       | الربط بنماذج الذكاء الاصطناعي السحابية التي تختارها |
| مستودعات Git وسجل التعديلات               | عمليات الدفع والسحب والنشر عبر GitHub               |
| بناء الملفات عبر الحزم المخزنة مسبقاً     | تنزيل حزم TeX الضرورية للتجميع المبدئي              |
| توليد ملفات PDF واستخراج النصوص           | جلب القوالب، الخطوط، أو أدوات مثل Pandoc وTinyTeX   |
| الفحص النحوي والتدقيق اللغوي الأولي       | استيراد الاقتباسات، تفقد المؤتمرات، وجلب التحديثات  |
| نماذج الذكاء الاصطناعي المحلية عبر Ollama | —                                                   |

تُحفظ مفاتيح الواجهات البرمجية (API Keys) محلياً دون أن تغادر بيئتك، كما تظل مستنداتك الأصلية بصيغ مفتوحة تتيح لك قراءتها وتعديلها بحرية تامة حتى وإن توقفت عن استخدام Oleafly مستقبلاً.

## **الرؤية المستقبلية وخارطة الطريق**

يواصل Oleafly التزامه الراسخ بالبرمجيات المفتوحة والمصممة على مبدأ الأولوية المحلية، ليواكب كافة مراحل رحلتك البحثية:

- **دعم لغوي شامل:** تعريب واجهة الاستخدام وإتاحة لغات متعددة لتمكين الباحثين بمختلف ألسنتهم.
- **إضافات ومهارات لوكلاء الذكاء الاصطناعي:** بناء مسارات عمل ذكية وقابلة لإعادة الاستخدام، تحد من هدر الرموز (Tokens) وتقلل تكرار السياق.
- **وكلاء بحث ذاتيون:** تحويل الفرضيات البحثية وحزم المراجع إلى مسودات مهيكلة تضعك مباشرة على طريق الإنجاز.
- **العمل التشاركي المباشر:** بيئة تعاون ومراجعة فورية تدعم الاستضافة الذاتية للفرق دون قيود.
- **واجهة سطر الأوامر (CLI):** حزمة خفيفة مخصصة لإدارة وتوليد الأبحاث للمطورين والباحثين من خارج الواجهات الرسومية.
- **توسع في دعم Typst وMarkdown:** تعزيز أدوات التحرير والمعاينة الحية والتصدير لهذين التنسيقين.
- **تكامل أوسع للمراجع:** ربط مباشر مع منصات Mendeley والمكتبات الرقمية وقواعد البيانات الأكاديمية.
- **مزامنة ذاتية الاستضافة:** تسهيل تناقل الملفات بسلاسة بين أجهزتك الخاصة، مع تحسين الاتصال التلقائي بمستودعات GitHub عند تفعيله.

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
````


يُرجى الاطلاع على [دليل التطوير](https://chatgpt.com/c/docs/development.md) للإحاطة بالمتطلبات الأساسية، وتهيئة بيئات العمل لمختلف المنصات، وبناء حزم الإنتاج، فضلًا عن مسارات العمل عبر سطر الأوامر انطلاقًا من الكود المصدري.

تتولى هذه البرمجيات النصية (Scripts) تحميل البرامج الجانبية للمترجم (Compiler Sidecars) الموثقة بالبصمة الرقمية (Checksum-pinned) والموافقة لبيئة تشغيلك الحالية، وإيداعها في المسار: `src-tauri/binaries`.

أما المعامل `all`، فيُستعان به ضمن عمليات التكامل المستمر (CI) وبناء الإصدارات النهائية؛ حيث تتطلب هذه المراحل تهيئة كافة المنصات المدعومة بالتوازي.

يظل تفعيل مزايا الإكمال الذكي للمحرر عبر خادمي `TexLab` و`Tinymist` أمرًا اختياريًا في بيئة التطوير المحلية، ويمكنك جلب خوادم اللغات هذه عبر تنفيذ الأمر:

```bash
pnpm language-servers:fetch
```

ولمزيد من التفاصيل حول معايير الأمان، وسياسات التراخيص، وآليات التوزيع، يُرجى مراجعة [سلسلة أدوات خوادم اللغات](https://chatgpt.com/c/docs/language-server-toolchain.md).

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

لاستعراض القائمة الكاملة للأوامر والخيارات المتاحة، نفّذ:

```bash
oleaflyc --help
```

لعرض القائمة الكاملة للأوامر.

## مراجع المطورين

تتوفر أدلة الاستخدام العامة ضمن [وثائق منتج Oleafly](https://oleafly.com/docs/overview/)، بينما خُصصت الأدلة والمراجع الواردة أدناه للمساهمين في المشروع، ومطوّري خدمات التكامل، ومسؤولي إطلاق الإصدارات.

|المرجع|الموضوع|
|---|---|
|[فهرس الهندسة التقنية](https://chatgpt.com/c/docs/README.md)|جرد الميزات والمواصفات الهندسية|
|[مرجع الميزات](https://chatgpt.com/c/docs/features.md)|إمكانيات المنتج ومسارات العمل المدعومة|
|[محركات المستندات](https://chatgpt.com/c/docs/document-engines.md)|إمكانيات LaTeX وTypst وMarkdown|
|[معمارية المنتج](https://chatgpt.com/c/docs/architecture.md)|حدود النظام، وهيكلية الحزم، ونقاط التوسعة|
|[التطوير](https://chatgpt.com/c/docs/development.md)|الإعداد المحلي، والاختبارات، وسير عمل المساهمة|
|[سلسلة أدوات خوادم اللغات](https://chatgpt.com/c/docs/language-server-toolchain.md)|سياسات الجلب، والتحقق من السلامة، والتوزيع|
|[تكامل MCP](https://chatgpt.com/c/docs/mcp.md)|العملاء الخارجيون، ورموز الوصول، وسياسات التحقق|
|[إطلاق الإصدارات](https://chatgpt.com/c/docs/releasing.md)|خطوات بناء الإصدارات وفحص المخرجات|
|[توقيع الشيفرة البرمجية](https://chatgpt.com/c/docs/signing.md)|متطلبات توقيع التطبيقات للمنصات المختلفة|
|[التحديثات التلقائية](https://chatgpt.com/c/docs/updates.md)|ملفات التحديث، والتواقيع الرقمية، وخيارات التراجع|

## المساهمة

|![The Oleafly Club: an open-source research community celebrating drafts, revisions, tests, and successful submissions](https://chatgpt.com/c/docs/assets/oleafly-club.png)|### يستحق الباحثون أدوات برمجية يمكنهم فحصها، وتوسيعها، والوثوق بها.|
|---|---|
||يتم بناء Oleafly بشكل مفتوح ومباشر بواسطة [Prajwal Murthy](https://github.com/prajwal-svm) ونخبة من المساهمين. نرحب بالتبليغ عن المشكلات البرمجية، والإصلاحات، والقوالب، والتوثيق، والآراء البناءة لتطوير المنتج.|

1. اقرأ ملف [CONTRIBUTING.md](CONTRIBUTING.md).
    
2. افتح تقرير مشكلة (issue) قبل البدء بتغييرات جوهرية كبيرة. يمكن إرسال الإصلاحات الصغيرة المحددة مباشرة عبر طلب دمج (pull request).
    
3. شغّل الفحوصات اللازمة قبل إرسال المساهمة:
    

```bash
pnpm build
pnpm test
cargo test --workspace --all-targets
```

يرجى الإبلاغ عن الثغرات الأمنية بشكل سري وخاص وفقاً للإرشادات الموضحة في . وتخضع كافة المشاركات لمعايير 
نُقدّر إبلاغكم عن أي ثغرات أمنية بسرية وخصوصية وفق الإرشادات المبينة في [SECURITY.md](SECURITY.md)، علمًا بأن جميع المساهمات تلتزم بأحكام [ميثاق السلوك الأخلاقي](CODE_OF_CONDUCT.md).

## المجتمع والدعم

- **حلقات النقاش:** اطرح استفساراتك، وشاركنا رؤاك، واقترح مسارات عمل مبتكرة عبر [GitHub Discussions](https://github.com/Oleafly/Oleafly/discussions).
- **التطوير والتحسين:** أبلغ عن الأعطال البرمجية وساهم بأفكارك للميزات القادمة عبر [GitHub Issues](https://github.com/Oleafly/Oleafly/issues).
- 🔔 **المستجدات:** 🔔 تابع حسابنا [@OleaflyHQ on X](https://x.com/OleaflyHQ) لتواكب أحدث الإصدارات والتحديثات أولاً بأول.
- **الدعم والمؤازرة:**  إن كان **Oleafly** قد أضفى قيمةً على مسيرتك البحثية، فإن دعمك للمشروع عبر ⭐يُعدّ حافزًا جوهريًا؛ خطوة بسيطة تُعزز وصوله إلى مزيد من الباحثين وتضمن استدامة تطويره.
    

## سجل النجوم (Star History)

[Star History](https://www.star-history.com/?repos=Oleafly%2FOleafly&type=date&legend=top-left)

![Star History Chart](https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&legend=top-left&sealed_token=ZRIr-1jiqjn35WhaqiDqKsmeII-LmnrILQdxzg5v_RX8-PFtlYa4d5IY7U2-Mcn1_D2-0k4e440BGXMhRskNzn-mZUGI59rpIErWId2F600cSJDgZqwcQ3BxV6zC3m5peZz6s_P_Mla0ZW06zikSg5LHLCIALEzrFnLqag7R_rQ7haTYEGHvSdgx76__)

## شكر وتقدير

يعتمد Oleafly في بنائه على جهود مشاريع مفتوحة المصدر:

[Tauri](https://tauri.app/),[React](https://react.dev/),[CodeMirror](https://codemirror.net/),[Tectonic](https://tectonic-typesetting.github.io/),[Typst](https://typst.app/),[pdf.js](https://mozilla.github.io/pdf.js/),[Zustand](https://github.com/pmndrs/zustand),[Tailwind CSS](https://tailwindcss.com/), [Harper](https://writewithharper.com/), and
[Hunspell](https://hunspell.github.io/).

يخضع Oleafly لترخيص [AGPL-3.0-or-later](https://chatgpt.com/c/LICENSE). وتتوفر إشعارات الأطراف الخارجية في ملف [THIRD_PARTY_LICENSES.md](https://chatgpt.com/c/THIRD_PARTY_LICENSES.md).
