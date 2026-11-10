import { MaintenancePanel } from '../../../ui-shared/maintenance-panel'
import { maintenanceApi } from '../api/maintenance'
import { store } from '../state/store'

/**
 * 维护。
 *
 * 上游把这一块直接做成了「定时任务」页的整页内容；我们保留了自建的定时任务页，
 * 所以把维护独立成二级页面，从「更多」进入，不占用底部主 Tab。
 */
export function MaintenancePage() {
  return <div className='m-page'>
    <MaintenancePanel
      api={maintenanceApi}
      notify={(message, kind) => store.toast(message, kind)}
      onChanged={() => store.refresh(true)}
      onAccount={id => store.push('accounts', { id })}
    />
  </div>
}
