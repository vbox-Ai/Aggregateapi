#!/usr/bin/env python3
"""手机端自检：抓「编译不报错、跑起来才发现」的四类问题。

这些错误有个共同点：TypeScript 一个都不拦。

  ① **图标名写错** —— `Icon` 是按 `PATHS[name]` 取的，名字不在表里就渲染成空白，
     既没有类型错误也不会抛异常。
  ② **`t()` 占位符与传参不匹配** —— 少传参数时 i18n 原样留下 `{count}` 字面量。
  ③ **跳转目标不存在** —— `store.push('xx')` 写了不存在的屏幕 id，
     `normalizeRoute` 会静默回首页，用户看到的是「点了没反应」。
  ④ **端点路径拼错** —— 只会在运行时 404。这里用「与契约文档里的端点编辑距离很近」
     作为启发式：**只报可疑项**，不做全量比对（契约文档只覆盖设置类模块，
     其余模块的端点不在文档里属正常）。

用法（仓库根目录执行）：
  python3 scripts/check-mobile-ui.py
只在本机核对时可以用 --root 指到别处。
"""
import argparse
import os
import re
import sys

ICON_USE = re.compile(r"<Icon\s+name=['\"](\w+)['\"]")
ICON_DEF = re.compile(r'^  ([a-zA-Z0-9_]+):', re.M)
I18N_CALL = re.compile(r"\bt\('")
PLACEHOLDER = re.compile(r'\{(\w+)\}')
NAV_CALL = re.compile(r"store\.(?:push|go)\(\s*'([^']+)'")
# MorePage 的**条目**长这样：`{ id: 'keys', label: t('网关 Key'), icon: 'key' }`；
# 而分组长这样：`{ id: 'system', title: t('系统'), entries: [...] }`。
# 用 `label:` 把两者分开 —— 否则分组 id 会被当成跳转目标（第一版就这么误报了）。
MORE_ENTRY = re.compile(r"\{ id: '([^']+)',\s*label:")
SCREEN_IDS = re.compile(r"export const SCREEN_IDS = \[(.*?)\]\s*as const", re.S)
ENDPOINT = re.compile(r"['\"`](/api/[A-Za-z0-9_./-]+)['\"`]")

# 跳转白名单：这几个 id 由插件动态提供或不进 SCREEN_IDS
NAV_ALLOW = {'plugin-page'}


def read(path: str) -> str:
    with open(path, encoding='utf-8') as handle:
        return handle.read()


def object_keys(body: str) -> set[str]:
    """对象字面量的顶层键，同时认 `key: value` 与简写 `key`。"""
    keys: set[str] = set()
    depth = 0
    current = ''
    for char in body[1:-1] + ',':
        if char in '([{':
            depth += 1
        elif char in ')]}':
            depth -= 1
        if char == ',' and depth == 0:
            part = current.strip()
            current = ''
            if not part:
                continue
            head = part.split(':', 1)[0].strip() if ':' in part else part.strip()
            if re.fullmatch(r'\w+', head):
                keys.add(head)
            continue
        current += char
    return keys


def check_placeholders(text: str, where: str) -> list[str]:
    problems: list[str] = []
    for match in I18N_CALL.finditer(text):
        start = match.end()
        end_quote = text.find("'", start)
        if end_quote < 0:
            continue
        template = text[start:end_quote]
        wanted = set(PLACEHOLDER.findall(template))
        if not wanted:
            continue
        cursor = end_quote + 1
        while cursor < len(text) and text[cursor] in ' \n\r\t':
            cursor += 1
        params: set[str] = set()
        if cursor < len(text) and text[cursor] == ',':
            cursor += 1
            while cursor < len(text) and text[cursor] in ' \n\r\t':
                cursor += 1
            if cursor < len(text) and text[cursor] == '{':
                depth = 0
                obj_start = cursor
                while cursor < len(text):
                    if text[cursor] == '{':
                        depth += 1
                    elif text[cursor] == '}':
                        depth -= 1
                        if depth == 0:
                            break
                    cursor += 1
                params = object_keys(text[obj_start:cursor + 1])
        missing = wanted - params
        if missing:
            line = text[:match.start()].count('\n') + 1
            problems.append(f'{where}:{line} t() 缺参数 {sorted(missing)}：{template[:50]!r}')
    return problems


def edit_distance(a: str, b: str) -> int:
    if abs(len(a) - len(b)) > 2:
        return 9
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ca != cb)))
        previous = current
    return previous[-1]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', default='.')
    args = parser.parse_args()
    root = os.path.abspath(args.root)
    mobile = os.path.join(root, 'desktop-tauri', 'mobile', 'src')
    if not os.path.isdir(mobile):
        print(f'[check] 找不到 {mobile}，请在仓库根目录运行')
        return 1

    problems: list[str] = []

    # ① 图标名
    icon_file = os.path.join(mobile, 'components', 'Icon.tsx')
    defined = set(ICON_DEF.findall(read(icon_file)))
    sources = []
    for dirpath, _, filenames in os.walk(mobile):
        for name in filenames:
            if name.endswith(('.ts', '.tsx')):
                sources.append(os.path.join(dirpath, name))
    for path in sources:
        text = read(path)
        where = os.path.relpath(path, mobile)
        for icon in sorted(set(ICON_USE.findall(text))):
            if icon not in defined:
                problems.append(f'{where}: 图标 {icon!r} 不在 Icon.tsx 的表里（会渲染成空白）')
        problems.extend(check_placeholders(text, where))

    # ③ 跳转目标
    # 只把 `store.push/go('x')`（任意文件）与 MorePage 里的宫格条目 `{ id: 'x' }`
    # 当作跳转目标 —— 别的文件里 `{ id: '…' }` 是业务数据，不是路由。
    routes = read(os.path.join(mobile, 'lib', 'routes.ts'))
    match = SCREEN_IDS.search(routes)
    ids = set(re.findall(r"'([a-z-]+)'", match.group(1))) if match else set()
    more_page = os.path.join(mobile, 'pages', 'MorePage.tsx')
    for path in sources:
        where = os.path.relpath(path, mobile)
        text = read(path)
        targets = set(NAV_CALL.findall(text))
        if os.path.abspath(path) == os.path.abspath(more_page):
            targets |= set(MORE_ENTRY.findall(text))
        for target in sorted(targets):
            if target in NAV_ALLOW or target in ids:
                continue
            # 插件页走 `plugin:<pack>:<page>`，不是固定 id
            if target.startswith('plugin:') or target.startswith('/'):
                continue
            problems.append(f'{where}: 跳转目标 {target!r} 不在 SCREEN_IDS 里（会静默回首页）')

    # ④ 端点疑似拼错：与契约文档里的端点编辑距离 ≤2
    contracts_dir = os.path.join(root, 'docs', 'mobile-ui', 'contracts')
    documented: set[str] = set()
    if os.path.isdir(contracts_dir):
        for name in os.listdir(contracts_dir):
            if name.endswith('.md'):
                documented |= set(ENDPOINT.findall(read(os.path.join(contracts_dir, name))))
    api_dir = os.path.join(mobile, 'api')
    if documented and os.path.isdir(api_dir):
        for name in sorted(os.listdir(api_dir)):
            if not name.endswith('.ts'):
                continue
            for endpoint in sorted(set(ENDPOINT.findall(read(os.path.join(api_dir, name))))):
                if endpoint in documented:
                    continue
                near = [d for d in documented if edit_distance(endpoint, d) <= 2]
                if near:
                    problems.append(f'api/{name}: {endpoint} 不在契约里，但和 {near} 很像 —— 疑似拼错')

    for line in problems:
        print(f'::error::{line}')
    if problems:
        print(f'[check] {len(problems)} 处问题')
        return 1
    print('[check] 手机端自检通过（图标名 / i18n 参数 / 跳转目标 / 端点拼写）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
