import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/shell";

export const Route = createFileRoute("/terms")({
  head: () => ({ meta: [{ title: "شروط الاستخدام — العش" }] }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <Shell>
      <article className="mx-auto max-w-2xl space-y-5 text-right leading-8 text-ivory/85">
        <h1 className="text-3xl font-extrabold text-ivory">شروط الاستخدام</h1>
        <p className="text-sm text-muted">هذا النص مسودة، ويحتاج مراجعة قبل الاعتماد عليه.</p>

        <h2 className="pt-2 text-xl font-bold text-ivory">الاستخدام</h2>
        <p>العش مجاني ومفتوح للجميع دون تسجيل. استخدمه للعب والسهر مع الآخرين بطريقة محترمة.</p>

        <h2 className="pt-2 text-xl font-bold text-ivory">المحتوى</h2>
        <p>أنت مسؤول عما تكتبه من أسماء وملاحظات داخل الموقع. نحتفظ بحق إزالة أي محتوى مسيء أو مخالف، وإغلاق أي غرفة تُستخدم بشكل ضار.</p>

        <h2 className="pt-2 text-xl font-bold text-ivory">الخدمة</h2>
        <p>نسعى لإبقاء الموقع متاحًا، لكن لا نضمن عمله دون انقطاع، وقد نغيّر الألعاب أو الميزات في أي وقت.</p>
      </article>
    </Shell>
  );
}
