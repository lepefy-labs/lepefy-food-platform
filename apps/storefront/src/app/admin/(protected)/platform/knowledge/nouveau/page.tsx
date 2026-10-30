import AdminPageHeader from '../../../../_components/ui/AdminPageHeader';
import NewArticleForm from './NewArticleForm';

export const dynamic = 'force-dynamic';

export default function NewKnowledgeArticlePage() {
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <AdminPageHeader
        title="Nouvel article"
        description="Un brouillon est créé en français. Vous le rédigez, le relisez, puis le publiez vous-même."
        breadcrumb={[{ label: 'Plateforme' }, { label: 'Base de connaissances', href: '/admin/platform/knowledge' }, { label: 'Nouvel article' }]}
      />
      <NewArticleForm />
    </div>
  );
}
