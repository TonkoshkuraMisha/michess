// --- FILE: frontend/src/components/DesignGallery.tsx ---
// Витрина общих компонентов дизайна (/design, в меню нет): владелец и разработчики видят все компоненты разом, на
// тех же текстах, что в разделах, — чтобы согласовать вид до перевода страниц. Компоненты — components/ui, правила —
// docs/design-system.md. Надписи витрины — каталог design.*, примеры карточек — тексты настоящих разделов.

import {useState} from 'react';
import {BookOpen, Crown, GraduationCap, Layers, Puzzle, Swords, Trophy} from 'lucide-react';
import {useI18n} from '../i18n';
import {Badge, Button, ButtonLink, Card, CardGrid, EmptyState, Page, PageHeader, ProgressBar, Section, SegmentedControl} from './ui';

type Demo = 'rated' | 'themes' | 'daily';

export function DesignGallery() {
    const {t} = useI18n();
    const [tab, setTab] = useState<Demo>('rated');
    return (
        <Page width="default" testId="design-gallery">
            <PageHeader icon={<Layers size={24}/>} title={t('design.title')} description={t('design.intro')}
                        actions={<ButtonLink to="/learn" variant="primary" icon={<GraduationCap size={16}/>}>{t('learn.title')}</ButtonLink>}/>

            <Section title={t('design.buttons')}>
                <div className="flex flex-wrap items-center gap-2">
                    <Button variant="primary" icon={<Swords size={16}/>}>{t('design.primary')}</Button>
                    <Button>{t('design.secondary')}</Button>
                    <Button variant="ghost">{t('design.ghost')}</Button>
                    <Button variant="danger">{t('design.danger')}</Button>
                    <Button variant="primary" size="sm">{t('design.small')}</Button>
                    <Button variant="primary" size="lg">{t('design.large')}</Button>
                    <Button disabled>{t('design.disabled')}</Button>
                </div>
            </Section>

            <Section title={t('design.tabs')}>
                <SegmentedControl<Demo> label={t('design.tabs')} value={tab} onChange={setTab} testIdPrefix="design-tab" options={[
                    {id: 'rated', label: t('design.tabRated'), icon: <Puzzle size={14}/>},
                    {id: 'themes', label: t('design.tabThemes'), icon: <BookOpen size={14}/>},
                    {id: 'daily', label: t('design.tabDaily'), icon: <Crown size={14}/>},
                ]}/>
            </Section>

            <Section title={t('design.cards')}>
                <Card variant="hero" icon={<Layers size={22}/>} title={t('supercourse.title')} description={t('supercourse.card')}
                      badge={<Badge tone="accent">{t('design.current')}</Badge>}
                      footer={<><ProgressBar value={3} max={8} label={t('design.progress')}/><ButtonLink to="/learn/course" variant="primary" size="sm">{t('design.continue')}</ButtonLink></>}/>
                <CardGrid>
                    <Card to="/learn/mates" icon={<Crown size={20}/>} title={t('mateCourse.title')} description={t('mateCourse.card')}
                          badge={<Badge tone="success">{t('design.done')}</Badge>} footer={<ProgressBar value={20} max={20} label={t('design.progress')}/>}/>
                    <Card to="/learn/endgames" icon={<BookOpen size={20}/>} title={t('design.cardEndgames')} footer={<ProgressBar value={7} max={33} label={t('design.progress')}/>}/>
                    <Card variant="muted" icon={<Trophy size={20}/>} title={t('design.cardLocked')} badge={<Badge tone="danger">{t('design.locked')}</Badge>}/>
                </CardGrid>
            </Section>

            <Section title={t('design.indicators')}>
                <div className="flex flex-wrap gap-2">
                    <Badge>{t('design.neutral')}</Badge>
                    <Badge tone="accent">{t('design.current')}</Badge>
                    <Badge tone="success">{t('design.done')}</Badge>
                    <Badge tone="danger">{t('design.locked')}</Badge>
                </div>
                <div className="max-w-sm"><ProgressBar value={12} max={30} label={t('design.progress')}/></div>
            </Section>

            <Section title={t('design.empty')}>
                <EmptyState icon={<Puzzle size={28}/>} title={t('design.emptyTitle')} description={t('design.emptyText')}
                            action={<ButtonLink to="/puzzles" variant="primary">{t('design.emptyAction')}</ButtonLink>}/>
            </Section>
        </Page>
    );
}
