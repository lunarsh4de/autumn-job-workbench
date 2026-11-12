// Deliberately narrow site adapters. Only extension runtime commands can execute.
// Unrecognized site structures stop for the user; no credentials enter this file.
(() => {
  if (globalThis.__resumeBatchContentLoaded) return;
  globalThis.__resumeBatchContentLoaded = true;
  const inspections = new Map();
  const attempted = new Set();
  let busy = false;
  const text = node => String(node?.textContent || '').replace(/\s+/g, ' ').trim();
  const canonical = value => { try { return new URL(value, location.href).href; } catch { return ''; } };
  const visible = node => Boolean(node && !node.closest('[hidden],[aria-hidden="true"],fieldset[disabled]') && (() => {
    for (let el = node; el?.nodeType === 1; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    }
    return true;
  })());
  const all = (root, selector) => [...root.querySelectorAll(selector)].filter(visible);
  const one = (root, selector) => { const nodes = all(root, selector); return nodes.length === 1 ? nodes[0] : null; };
  const blocker = (code, message) => ({ code, message });
  const exact = (left, right) => String(left || '').normalize('NFKC').trim() === String(right || '').normalize('NFKC').trim();
  const label = node => `${node.getAttribute('aria-label') || ''} ${node.getAttribute('placeholder') || ''} ${node.name || ''} ${text(node.closest('label'))}`.trim().slice(0, 180);
  const failureSelectors = '.send-fail,.send-failed,.message-failed,.application-error,.ant-form-item-explain-error,[role="alert"],[data-status="failed"],[data-status="error"]';
  const failurePattern = /发送失败|未发送|提交失败|申请失败|请重试|系统错误|网络异常|send failed|failed to send|submission failed|application failed|try again|error/i;

  function base(job, adapter = 'unknown') {
    return { supported: false, adapter, job: { id: String(job?.id || ''), url: location.href, title: '', company: '', description: '' }, requiresAttachment: false, blockers: [] };
  }
  function identityMatches(actual, expected) {
    return Boolean(expected && expected.url && expected.title && expected.company && canonical(actual.url) === canonical(expected.url) && exact(actual.title, expected.title) && exact(actual.company, expected.company));
  }
  function globalBlockers() {
    const blockers = [];
    if (all(document, 'iframe[src*="captcha"],iframe[src*="recaptcha"],.geetest_panel,.geetest_holder,.captcha-container,[data-captcha],input[name*="captcha"],input[name*="verifyCode"]').length) blockers.push(blocker('captcha', '页面需要验证码，请本人完成。'));
    if (all(document, '.login-dialog,.login-modal,[data-login-required],input[type="password"]').length) blockers.push(blocker('login', '页面需要本人登录。'));
    return blockers;
  }
  function boss(job) {
    const result = base(job, 'boss');
    const jobId = /^\/job_detail\/([^/]+)\.html$/.exec(location.pathname)?.[1];
    const banner = one(document, '.job-banner');
    const title = banner && one(banner, '.job-name,h1');
    const company = banner && one(banner, '.company-name');
    result.job = { ...result.job, jobId, title: text(title), company: text(company), description: text(one(document, '.job-detail-box .job-sec-text,.job-detail .job-sec-text')) };
    if (!jobId || !banner || !identityMatches(result.job, job)) result.blockers.push(blocker('identity', '需要独立岗位详情页，并与审核岗位及公司完全一致。'));
    const conversations = all(document, '.chat-conversation,.chat-container');
    const matching = conversations.filter(root => {
      // The displayed conversation must identify this exact independent job URL.
      const info = one(root, '.chat-job-info');
      const links = info ? all(info, 'a[href]') : [];
      return links.some(link => canonical(link.href) === canonical(location.href)) &&
        exact(text(one(info, '.job-name,.job-title')), result.job.title) && exact(text(one(info, '.company-name')), result.job.company);
    });
    const root = matching.length === 1 ? matching[0] : null;
    const editor = root && one(root, '#chat-input,textarea.chat-input,[contenteditable="true"].chat-input');
    const senders = root ? all(root, 'button.btn-send,button.send-message').filter(node => /^(发送|Send)$/i.test(text(node))) : [];
    const send = senders.length === 1 ? senders[0] : null;
    let open = null;
    if (!root && !matching.length && !conversations.length && banner) {
      // A new "立即沟通" can itself send BOSS's default greeting. Never click
      // that entry without a verified existing conversation; it is not a pure opener.
      const entries = all(banner, '.op-btn .btn-startchat').filter(node => /^继续沟通$/.test(text(node)) && !node.disabled && node.getAttribute('aria-disabled') !== 'true');
      if (entries.length === 1) {
        const candidate = entries[0];
        const href = candidate.getAttribute('href');
        const destination = href ? new URL(href, location.href) : null;
        if (candidate.matches('button') || candidate.matches('a') && (!href || href === '#' || destination?.origin === location.origin && /^\/web\/geek\/chat(?:\/|$)/.test(destination.pathname))) open = candidate;
      }
    }
    if ((!root || !editor || !send) && !open) result.blockers.push(blocker('conversation', '未找到唯一、岗位身份明确的聊天会话或明确沟通入口。请本人打开对应会话。'));
    if (open) result.requiresConversation = true;
    if (editor && (editor.disabled || editor.readOnly || editor.getAttribute('aria-disabled') === 'true')) result.blockers.push(blocker('editor_disabled', '聊天输入框不可编辑。'));
    if (editor && String(editor.value ?? editor.textContent).trim()) result.blockers.push(blocker('existing_draft', '会话有未发送草稿，不覆盖本人内容。'));
    if (root && all(root, failureSelectors).some(node => failurePattern.test(text(node)) || node.matches('.send-fail,.send-failed,.message-failed'))) result.blockers.push(blocker('existing_failure', '会话存在发送失败状态，请本人检查。'));
    result.blockers.push(...globalBlockers());
    result.supported = !result.blockers.length;
    return { result, root, editor, send, open };
  }
  function moka(job) {
    const result = base(job, 'moka');
    const route = location.pathname + location.hash;
    const form = one(document, 'form.application-form,form[data-job-id]');
    const header = one(document, '.application-job,.apply-header,.job-header');
    result.job = { ...result.job, jobId: form?.dataset.jobId || '', title: text(header && one(header, '.job-title,.job-name,h1')), company: text(header && one(header, '.company-name')), description: text(one(document, '.job-description,.job-detail-description')) };
    const routeJobId = /(?:apply|application|resume)\/([^/?#]+)/i.exec(route)?.[1] || new URL(location.href).searchParams.get('jobId');
    if (!routeJobId || routeJobId !== result.job.jobId || !form || !header || !identityMatches(result.job, job)) result.blockers.push(blocker('identity', '当前不是身份明确的 Moka 最终申请表，需本人检查。'));
    const submitters = form ? all(form, 'button[type="submit"],input[type="submit"]')
      .filter(node => /^(提交申请|确认提交|Submit application)$/i.test(text(node) || node.value || '') && !node.disabled && node.getAttribute('aria-disabled') !== 'true') : [];
    const send = submitters.length === 1 ? submitters[0] : null;
    if (!send) result.blockers.push(blocker('submit_control', '未找到唯一明确的最终提交申请控件。'));
    if (all(document, '.ant-steps,.application-steps,[data-multi-step]').length || form && all(form, 'button').some(node => /^(下一步|继续|Next|Continue)$/i.test(text(node)))) result.blockers.push(blocker('multi_step', '多步骤申请需本人处理，不能跳过预览与声明。'));
    if (all(document, '[role="dialog"],[aria-modal="true"]').length) result.blockers.push(blocker('dialog', '页面有待处理对话框。'));
    if (form) {
      // Upload inputs are often visually hidden behind an upload button. Their
      // required/upload state still matters when the containing field is visible.
      const controls = [...form.querySelectorAll('input,select,textarea')].filter(field => visible(field) || field.type === 'file' && visible(field.parentElement));
      for (const field of controls) {
        if (field.disabled || field.type === 'hidden' || field.type === 'submit' || field.type === 'button') continue;
        const name = label(field) || '未命名字段';
        const required = field.required || field.getAttribute('aria-required') === 'true' || Boolean(field.closest('.ant-form-item-required,[data-required="true"]'));
        const legal = /同意|隐私|声明|条款|授权|consent|privacy|terms|declaration/i.test(name);
        if (legal && field.type === 'checkbox' && !field.checked) result.blockers.push(blocker('legal_unchecked', `需要本人阅读并勾选声明：${name}`));
        if (field.type === 'file') {
          result.requiresAttachment = result.requiresAttachment || required || /简历|resume|cv\b/i.test(name);
          const scope = field.closest('.ant-form-item,.upload-field,.form-item') || field.parentElement;
          const completed = scope && all(scope, '.upload-success,[data-upload-status="done"],.ant-upload-list-item-done').length > 0;
          const pending = scope && all(scope, '.ant-upload-list-item-uploading,[data-upload-status="uploading"],.upload-error').length > 0;
          if ((required || /简历|resume|cv\b/i.test(name)) && (!completed || pending)) result.blockers.push(blocker('attachment_pending', `附件尚未确认上传完成：${name}`));
          continue;
        }
        let missing = required && (field.type === 'checkbox' ? !field.checked : field.type === 'radio' ? !controls.some(other => other.type === 'radio' && other.name === field.name && other.checked) : !String(field.value || '').trim());
        if (missing) result.blockers.push(blocker('required_empty', `必填项未完成：${name}`));
        else if (field.validity && !field.validity.valid) result.blockers.push(blocker('invalid_field', `字段格式未通过页面校验：${name}`));
      }
      // Custom controls with no native input cannot be safely inferred or filled.
      for (const field of all(form, '[aria-required="true"],[data-required="true"]')) {
        if (!field.matches('input,select,textarea') && !field.querySelector('input,select,textarea')) result.blockers.push(blocker('custom_required', '存在需要本人回答的自定义必填项。'));
      }
      if (all(form, failureSelectors).some(node => text(node))) result.blockers.push(blocker('validation_error', '页面仍有表单错误。'));
    }
    result.blockers.push(...globalBlockers());
    const manual = new Set(['identity', 'submit_control', 'multi_step', 'dialog', 'captcha', 'login', 'custom_required']);
    result.supported = !result.blockers.some(item => manual.has(item.code));
    return { result, root: form, send };
  }
  function inspect(job) {
    if (location.hostname === 'www.zhipin.com') return boss(job);
    if (location.hostname === 'app.mokahr.com') return moka(job);
    const result = base(job); result.blockers.push(blocker('unsupported', '尚无经过识别的此官网最终提交适配器，请本人处理。'));
    return { result };
  }
  const publicResult = result => ({ ...result, reason: result.blockers.map(item => item.message).join(' ') || (result.requiresConversation ? '已识别当前岗位和明确沟通入口；批准后仅在同页会话身份核对成功时发送，否则暂停。' : '已识别当前岗位与唯一操作控件；执行前仍会再次检查。') });
  function fingerprint(state) {
    return JSON.stringify({ job: state.result.job, blockers: state.result.blockers, editor: state.editor ? String(state.editor.value ?? state.editor.textContent) : '', controls: state.root ? [...state.root.querySelectorAll('input,select,textarea')].map(field => [field.name, field.type, field.value, field.checked, field.disabled]) : [] });
  }
  function evidenceNodes(state) {
    return state.result.adapter === 'boss'
      ? all(state.root, '.message-item.is-self .text,.message-item.self .text,.message-item.is-self .message-text,.message-item.self .message-text')
      : all(document, '.application-success,[data-application-status="success"]');
  }
  function waitEvidence(state, greeting, before, baselineFailures) {
    return new Promise(resolve => {
      let settled = false, settleTimer;
      const finish = value => { if (settled) return; settled = true; observer.disconnect(); clearTimeout(timeout); clearTimeout(settleTimer); resolve(value); };
      const read = () => {
        if (canonical(location.href) !== canonical(state.result.job.url)) return { status: 'uncertain', reason: '操作后页面已导航，无法把结果可靠绑定到原岗位；请本人核对，勿自动重试。' };
        const failures = all(document, failureSelectors).filter(node => baselineFailures.get(node) !== text(node) && (failurePattern.test(text(node)) || node.matches('.send-fail,.send-failed,.message-failed,[data-status="failed"],[data-status="error"]')));
        if (failures.length) return { status: 'failed', reason: '页面报告发送或提交失败，未标记完成。', evidence: text(failures[0]).slice(0, 300) };
        if (state.result.adapter === 'boss') {
          const info = one(state.root, '.chat-job-info');
          if (!info || !all(info, 'a[href]').some(link => canonical(link.href) === canonical(state.result.job.url)) || !exact(text(one(info, '.job-name,.job-title')), state.result.job.title) || !exact(text(one(info, '.company-name')), state.result.job.company)) return { status: 'uncertain', reason: '聊天会话身份已变化，无法确认原岗位发送结果。' };
          const fresh = evidenceNodes(state).find(node => {
            const item = node.closest('.message-item');
            const acknowledged = item && (item.matches('[data-status="sent"],[data-status="delivered"],.sent,.delivered') || all(item, '.message-status').some(status => /^(已发送|已送达|Sent|Delivered)$/i.test(text(status))));
            return !before.has(node) && String(node.textContent || '').trim() === greeting.trim() && acknowledged && !node.closest('.pending,.sending,.failed,[data-status="pending"],[data-status="sending"],[data-status="failed"]');
          });
          return fresh ? { status: 'communicated', reason: '对应岗位会话出现新增本人消息，正文与审核文本一致，页面标记已发送或已送达且无失败。此为页面证据。', evidence: { kind: 'new_self_message_acknowledged', text: greeting, jobUrl: state.result.job.url } } : null;
        }
        const success = evidenceNodes(state).find(node => !before.has(node) && /^(?:申请成功|投递成功|提交成功|Application submitted|Application received|Thank you for applying)[！!。.\s]*$/i.test(text(node.querySelector('.success-title,h1,h2') || node)) &&
          ((state.result.job.jobId && node.dataset.jobId === state.result.job.jobId) || (exact(text(node.querySelector('.job-title,.job-name')), state.result.job.title) && exact(text(node.querySelector('.company-name')), state.result.job.company))));
        return success ? { status: 'submitted', reason: '出现新增、绑定当前岗位的明确申请成功结果。', evidence: { kind: 'new_application_success', text: text(success).slice(0, 300), jobUrl: state.result.job.url } } : null;
      };
      const observe = () => {
        const value = read();
        if (value?.status === 'failed' || value?.status === 'uncertain') return finish(value);
        if (value && !settleTimer) settleTimer = setTimeout(() => { const final = read(); if (final) finish(final); else settleTimer = null; }, 600);
      };
      const observer = new MutationObserver(observe);
      observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      const timeout = setTimeout(() => finish({ status: 'uncertain', reason: '未观察到新的明确完成证据；请本人核对，不自动重试。' }), 7000);
      observe();
    });
  }
  function openConversation(state, job) {
    return new Promise(resolve => {
      const expectedUrl = location.href;
      let done = false;
      const finish = value => { if (done) return; done = true; observer.disconnect(); clearTimeout(timeout); resolve(value); };
      const check = () => {
        if (location.href !== expectedUrl) return finish(null);
        const next = inspect(job);
        if (next.result.blockers.some(item => ['identity', 'captcha', 'login'].includes(item.code))) return finish(null);
        if (next.root && next.editor && next.send && next.result.supported && !next.result.blockers.length) finish(next);
      };
      const observer = new MutationObserver(check);
      observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      const timeout = setTimeout(() => finish(null), 5000);
      state.open.click();
      check();
    });
  }
  async function execute(message) {
    const paused = reason => ({ status: 'paused', reason });
    if (busy) return paused('已有执行中的操作。');
    const token = message.inspection?.inspectionId;
    const saved = inspections.get(token); inspections.delete(token);
    if (!saved || Date.now() - saved.at > 120000 || message.approved !== true || typeof message.attemptId !== 'string' || !message.attemptId || message.attemptId.length > 160 || attempted.has(message.attemptId)) return paused('执行缺少有效的本页单次审核检查或批准，或该尝试已经执行。');
    let current = inspect(message.job);
    if (!current.result.supported || current.result.blockers.length || fingerprint(current) !== saved.fingerprint || current.root !== saved.root || current.send !== saved.send || current.editor !== saved.editor || current.open !== saved.open) return { ...paused('岗位、表单或会话已变化，请重新检查。'), blockers: current.result.blockers };
    if (message.inspection.adapter !== current.result.adapter || !identityMatches(current.result.job, message.inspection.job)) return paused('检查结果与当前岗位不一致。');
    const greeting = typeof message.greeting === 'string' ? message.greeting : '';
    if (current.result.adapter === 'boss' && (!greeting.trim() || greeting.length > 1500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(greeting))) return paused('需要用户审核后的有效打招呼正文。');
    busy = true;
    try {
      if (current.open) {
        const opened = await openConversation(current, message.job);
        if (!opened) return paused('已打开沟通入口，但同页未出现可核对的唯一岗位会话；若已跳转或另开标签，请本人核对，不自动发送。');
        current = opened;
      }
      const before = new Set(evidenceNodes(current));
      const failures = new Map(all(document, failureSelectors).map(node => [node, text(node)]));
      if (current.editor) {
        const editor = current.editor;
        if (editor.matches('textarea,input')) {
          const descriptor = Object.getOwnPropertyDescriptor(editor.matches('textarea') ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value');
          descriptor.set.call(editor, greeting);
        } else editor.textContent = greeting;
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: greeting }));
        if (String(editor.value ?? editor.textContent) !== greeting) return paused('页面拒绝了审核正文，未发送。');
        const rechecked = inspect(message.job);
        if (canonical(location.href) !== canonical(current.result.job.url) || rechecked.root !== current.root || rechecked.send !== current.send || rechecked.editor !== editor || rechecked.result.blockers.some(item => item.code !== 'existing_draft')) return paused('输入正文后岗位或会话变化，未发送。');
      }
      if (current.send.disabled || current.send.getAttribute('aria-disabled') === 'true' || !current.send.isConnected || !visible(current.send)) return paused('最终操作控件不可用，未执行。');
      attempted.add(message.attemptId);
      // Snapshot and observe before clicking, including synchronous app handlers.
      const evidence = waitEvidence(current, greeting, before, failures);
      current.send.click();
      return await evidence;
    } catch (error) { return { status: 'uncertain', reason: `操作结果无法确认：${String(error.message).slice(0, 250)}。请本人核对，勿自动重试。` }; }
    finally { busy = false; }
  }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (!['batchInspect', 'batchExecute'].includes(message?.type)) return;
    if (!chrome.runtime.id || sender?.id !== chrome.runtime.id || sender.tab || (sender.url && !sender.url.startsWith(`chrome-extension://${chrome.runtime.id}/`))) {
      reply({ status: 'paused', supported: false, reason: '只接受本扩展后台或扩展页面命令。' }); return;
    }
    if (message.type === 'batchInspect') {
      try {
        const state = inspect(message.job); const result = publicResult(state.result);
        if (result.supported) {
          if (inspections.size > 20) inspections.clear();
          result.inspectionId = crypto.randomUUID();
          inspections.set(result.inspectionId, { at: Date.now(), fingerprint: fingerprint(state), root: state.root, editor: state.editor, send: state.send, open: state.open });
        }
        reply(result);
      } catch { reply({ supported: false, adapter: 'unknown', reason: '页面结构未能可靠识别，请本人处理。', blockers: [blocker('schema', '页面结构未能可靠识别。')] }); }
      return;
    }
    execute(message).then(reply).catch(() => reply({ status: 'uncertain', reason: '操作结果无法确认，请本人核对。' }));
    return true;
  });
})();
