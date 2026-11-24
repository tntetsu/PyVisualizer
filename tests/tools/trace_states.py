"""trace_states.py — CPython で Python プログラムを実行し、変数の状態の変化の列を JSON で出す

  python3 -I tests/tools/trace_states.py <program.py>

sys.settrace で、各行の実行前（line）と関数を抜けるとき（return）に、そのフレームの変数の repr を取り、
前回から変わったものを「関数名:変数名=repr」として順に記録する。
関数のフレームは自分のローカル変数（co_varnames と、内側の関数が使う co_cellvars）だけを見る。
内側の関数から見た外側の変数（co_freevars）は、外側のフレームで記録されるので含めない。
モジュールのフレームは、__ で始まる名前と、関数・モジュール・クラスを除く。
PyVisualizer の tests/line-state.test.js が、PyDebugger のトレースから作った列と比べる。
"""
import builtins
import io
import json
import sys
import types

SKIP_TYPES = (types.FunctionType, types.BuiltinFunctionType, types.ModuleType, type)


def main():
    path = sys.argv[1]
    with open(path, encoding='utf-8') as f:
        code = compile(f.read(), path, 'exec')

    changes = []
    prev = {}

    def snapshot(frame):
        co = frame.f_code
        if co.co_name == '<module>':
            items = {k: v for k, v in frame.f_locals.items() if not k.startswith('__')}
        else:
            names = set(co.co_varnames) | set(co.co_cellvars)
            items = {k: v for k, v in frame.f_locals.items() if k in names}
        return {k: repr(v) for k, v in items.items() if not isinstance(v, SKIP_TYPES)}

    def check(frame):
        cur = snapshot(frame)
        old = prev.get(id(frame), {})
        for k, v in cur.items():
            if old.get(k) != v:
                changes.append(f'{frame.f_code.co_name}:{k}={v}')
        prev[id(frame)] = cur

    def tracer(frame, event, arg):
        if frame.f_code.co_filename != path:
            return None
        if event == 'call':
            prev[id(frame)] = {}
        elif event in ('line', 'return'):
            check(frame)
            if event == 'return':
                prev.pop(id(frame), None)
        return tracer

    g = {'__name__': '__main__', '__builtins__': builtins}
    error = None
    out, sys.stdout = sys.stdout, io.StringIO()   # プログラムの print は JSON と混ぜない
    sys.settrace(tracer)
    try:
        exec(code, g)
    except BaseException as e:  # noqa: BLE001  例外で終わるプログラムも、そこまでの変化を出す
        error = type(e).__name__
    finally:
        sys.settrace(None)
        sys.stdout = out
    json.dump({'changes': changes, 'error': error}, sys.stdout, ensure_ascii=False)


if __name__ == '__main__':
    main()
