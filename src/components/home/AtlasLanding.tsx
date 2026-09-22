import type { CourseNebulaSummary } from '../../types';

interface AtlasLandingProps {
  summaries?: CourseNebulaSummary[];
  onOpenLibrary: () => void;
  onOpenQa: () => void;
  onOpenSettings: () => void;
  onOpenCourse?: (id: string) => void;
}

export function AtlasLanding({ summaries = [], onOpenLibrary, onOpenQa, onOpenSettings, onOpenCourse }: AtlasLandingProps) {
  const total = summaries.reduce((sum, course) => sum + course.knowledgeCount, 0);
  return <main className="atlas-home">
    <header className="atlas-header">
      <a href="#top" className="atlas-brand"><span className="atlas-seal" aria-hidden="true">纲</span><span>知纲<small>THE KNOWLEDGE ATLAS</small></span></a>
      <nav aria-label="首页导航"><button onClick={onOpenLibrary}>课件库</button><button onClick={onOpenQa}>全库知识问答</button><button onClick={onOpenSettings}>服务配置 ↗</button></nav>
    </header>
    <section id="top" className="atlas-hero">
      <div className="atlas-hero-copy">
        <p className="atlas-kicker">A PERSONAL ATLAS OF KNOWLEDGE</p>
        <span className="atlas-rule" aria-hidden="true" />
        <h1>循着知识，<br />看见更大的<span>世界。</span></h1>
        <p className="atlas-intro">从一份课件出发，整理概念、连接线索。<br />把每一次学习，收录进自己的知识地图集。</p>
        <div className="atlas-actions"><button className="btn-primary" onClick={onOpenLibrary}>{summaries.length ? '打开我的课件库' : '添加第一份课件'} <span aria-hidden="true">↗</span></button><button className="atlas-text-button" onClick={onOpenQa}>向知识库提问 →</button></div>
        <div className="atlas-statline"><span><b>{String(summaries.length).padStart(2, '0')}</b> 门课程</span><span><b>{String(total).padStart(2, '0')}</b> 个知识点</span><span>每条线索，皆有出处</span></div>
      </div>
      <div className="atlas-map" role="img" aria-label="古典海岸地图装饰画">
        <div className="atlas-map-label"><span>知 识 图 志</span><small>CHARTING IDEAS · CONNECTING WORLDS</small></div>
        <span className="atlas-map-edition">VOL. I / 学习的疆域</span>
      </div>
    </section>
    <section className="atlas-collection" aria-labelledby="collection-heading">
      <div className="atlas-section-heading"><div><p className="atlas-kicker">THE COLLECTION</p><h2 id="collection-heading">我的课程图集</h2></div><button onClick={onOpenLibrary} className="atlas-text-button">管理全部课件 ↗</button></div>
      {summaries.length > 0 ? <div className="atlas-course-grid">{summaries.map((course, i) => <button key={course.courseId} onClick={() => onOpenCourse?.(course.courseId)} className={`atlas-course atlas-course-${i % 3}`} aria-label={`打开课程：${course.courseName}`}>
        <div className="atlas-course-art" aria-hidden="true"><span>PLATE {String(i + 1).padStart(2, '0')}</span><span className="atlas-course-symbol">✧</span></div>
        <div className="atlas-course-content"><span className="atlas-kicker">课程 / {String(i + 1).padStart(2, '0')}</span><h3>{course.courseName}</h3><p>{course.documentCount} 份课件 <span>·</span> {course.knowledgeCount} 个知识点 <span className="atlas-course-arrow">↗</span></p></div>
      </button>)}</div> : <div className="atlas-empty"><h3>你的第一卷知识图集，从这里开始。</h3><p>导入课程材料，将课件整理为知识结构、知识卡片与完整笔记。</p><a href="#workflow">了解如何工作 ↓</a></div>}
    </section>
    <section id="workflow" className="atlas-workflow">{[['01', '收录课件', 'PDF、PPTX 与 Markdown，归档到各自的课程。'], ['02', '梳理知识', '知识结构、知识卡片、完整笔记，层次清晰。'], ['03', '循源求知', '跨课件提问，沿着引用回到原始证据。']].map(([n, title, copy]) => <article key={n}><span>{n}</span><div><h3>{title}</h3><p>{copy}</p></div></article>)}</section>
    <footer className="atlas-footer"><span>知纲 · 私人的知识地图集</span><span>EXPLORE · CONNECT · UNDERSTAND</span></footer>
  </main>;
}
