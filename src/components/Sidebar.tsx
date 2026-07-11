import { WorkflowStage } from '../types';
import { useStore } from '../store/useStore';

const stages: { key: WorkflowStage; label: string; num: string }[] = [
  { key: 'upload', label: '上传课件', num: '壹' },
  { key: 'parse-review', label: '解析确认', num: '贰' },
  { key: 'structure-review', label: '结构确认', num: '叁' },
  { key: 'generating', label: '编译生成', num: '肆' },
  { key: 'notes', label: '笔记视图', num: '伍' },
];

interface SidebarProps {
  onOpenSettings: () => void;
}

export function Sidebar({ onOpenSettings }: SidebarProps) {
  const stage = useStore(s => s.stage);
  const reset = useStore(s => s.reset);
  const document = useStore(s => s.document);
  const loadExample = useStore(s => s.loadExampleCourse);

  const currentIndex = stages.findIndex(s => s.key === stage);

  return (
    <aside className="w-56 md:w-64 bg-ink text-paper flex flex-col h-screen flex-shrink-0">
      {/* Logo */}
      <div className="p-6 border-b border-ink-light/30">
        <h1 className="font-song text-2xl font-bold tracking-wider">知纲</h1>
        <p className="text-paper/60 text-xs mt-1 font-mono">课件编译器 v0.1</p>
      </div>

      {/* 流程导航 */}
      <nav className="flex-1 p-4 overflow-y-auto">
        <div className="mb-6">
          <p className="text-paper/40 text-xs font-mono mb-3 uppercase tracking-widest">编译流程</p>
          <div className="space-y-1">
            {stages.map((s, idx) => {
              const isActive = s.key === stage;
              const isPast = idx < currentIndex;

              return (
                <div
                  key={s.key}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded transition-colors ${
                    isActive
                      ? 'bg-cinnabar text-white'
                      : isPast
                      ? 'text-paper/80 hover:bg-ink-light/30'
                      : 'text-paper/40'
                  }`}
                >
                  <span className={`font-mono text-sm w-6 text-center ${
                    isActive ? 'text-white' : isPast ? 'text-celadon' : ''
                  }`}>
                    {s.num}
                  </span>
                  <span className="text-sm">{s.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 当前文档信息 */}
        {document && (
          <div className="mb-6">
            <p className="text-paper/40 text-xs font-mono mb-3 uppercase tracking-widest">当前课件</p>
            <div className="bg-ink-light/20 rounded p-3">
              <p className="text-sm font-song truncate" title={document.title}>
                {document.title}
              </p>
              <p className="text-paper/50 text-xs mt-1 font-mono">
                {document.pages.length} 页
              </p>
            </div>
          </div>
        )}
      </nav>

      {/* 底部操作 */}
      <div className="p-4 border-t border-ink-light/30 space-y-2">
        <button
          onClick={onOpenSettings}
          className="w-full text-left px-3 py-2 text-sm text-paper/70 hover:text-white hover:bg-ink-light/30 rounded transition-colors"
        >
          模型配置
        </button>
        <button
          onClick={loadExample}
          className="w-full text-left px-3 py-2 text-sm text-paper/70 hover:text-white hover:bg-ink-light/30 rounded transition-colors"
        >
          加载示例课程
        </button>
        <button
          onClick={() => {
            if (confirm('确定要重置项目吗？所有进度将丢失。')) {
              reset();
            }
          }}
          className="w-full text-left px-3 py-2 text-sm text-paper/70 hover:text-cinnabar-light hover:bg-ink-light/30 rounded transition-colors"
        >
          重置项目
        </button>
      </div>
    </aside>
  );
}
