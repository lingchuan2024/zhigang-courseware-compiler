import { useStore } from '../store/useStore';
import { DocumentReviewWorkspace } from './document-review/DocumentReviewWorkspace';

/**
 * 课件解析审阅页面 - 委托给 DocumentReviewWorkspace 三栏工作台
 */
export function ParseReviewView() {
  const startMinerUParse = useStore(state => state.startMinerUParse);
  return <DocumentReviewWorkspace onRequestMinerUParse={startMinerUParse} />;
}
