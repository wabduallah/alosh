import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/shell";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "سياسة الخصوصية — العش" }] }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <Shell>
      <article className="mx-auto max-w-2xl space-y-5 text-right leading-8 text-ivory/85">
        <h1 className="text-3xl font-extrabold text-ivory">سياسة الخصوصية</h1>
        <p className="text-sm text-muted">هذا النص مسودة، ويحتاج مراجعة قبل الاعتماد عليه.</p>

        <h2 className="pt-2 text-xl font-bold text-ivory">ما الذي نحفظه؟</h2>
        <ul className="list-disc space-y-2 pr-6">
          <li>جلسة مجهولة في المتصفح تُنشأ تلقائيًا، لا تحتوي على اسمك أو بريدك.</li>
          <li>الاسم الذي تكتبه داخل الغرفة، وما تختاره أثناء اللعب، ويُحذف مع انتهاء الغرفة.</li>
          <li>الملاحظة وبريد التواصل إن أرسلتهما من صفحة الملاحظات.</li>
          <li>بريدك إن طلبت تنبيهًا عند إطلاق لعبة، ولا نرسل لك غير هذا التنبيه الواحد.</li>
        </ul>

        <h2 className="pt-2 text-xl font-bold text-ivory">كيف نستخدمها؟</h2>
        <p>لتشغيل الألعاب ومزامنة الغرف بين الأجهزة، وللرد على ملاحظاتك. لا نبيع بياناتك ولا نعرضها للإعلانات.</p>

        <h2 className="pt-2 text-xl font-bold text-ivory">التواصل</h2>
        <p>لأي استفسار عن بياناتك، أرسل ملاحظة من صفحة «أرسل ملاحظة».</p>
      </article>
    </Shell>
  );
}
