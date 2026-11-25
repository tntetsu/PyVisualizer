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
import re
import sys
import types

SKIP_TYPES = (types.FunctionType, types.BuiltinFunctionType, types.ModuleType, type, types.MethodType)
BUILTIN_VALUE_TYPES = (int, float, str, bool, list, tuple, dict, set, frozenset, range, type(None))


def srepr(v):
    """repr と同じだが、集合は要素の repr を並べ替えて出す（CPython の集合の順序はハッシュ値で決まり、PyVisualizer と比べられないため）"""
    if isinstance(v, BaseException):
        return f'<{type(v).__name__}>'   # 例外は型だけを比べる（PyVisualizer がエンジンで投げる例外のメッセージは日本語）
    if not isinstance(v, BUILTIN_VALUE_TYPES) and hasattr(v, '__dict__'):
        # ユーザー定義のクラスのインスタンスは、ユーザーの __repr__ を呼ばずに属性から作る
        # （__init__ の途中などで __repr__ が失敗しうるため。PyVisualizer 側も同じ形にする）
        return f'<{type(v).__name__} {srepr(dict(vars(v)))}>'
    if isinstance(v, (set, frozenset)):
        return '{' + ', '.join(sorted(srepr(x) for x in v)) + '}' if v else 'set()'
    if isinstance(v, list):
        return '[' + ', '.join(srepr(x) for x in v) + ']'
    if isinstance(v, tuple):
        return '(' + srepr(v[0]) + ',)' if len(v) == 1 else '(' + ', '.join(srepr(x) for x in v) + ')'
    if isinstance(v, dict):
        return '{' + ', '.join(f'{srepr(k)}: {srepr(x)}' for k, x in v.items()) + '}'
    # map・イテレーターなどの「<… object at 0x…>」はアドレスを除く（PyVisualizer はアドレスを付けない。ADR-011）
    return re.sub(r' at 0x[0-9a-f]+', '', repr(v))


def main():
    path = sys.argv[1]
    with open(path, encoding='utf-8') as f:
        code = compile(f.read(), path, 'exec')

    changes = []
    prev = {}
    last_line = {}   # id(frame) → 直前の line イベントの行

    def snapshot(frame):
        co = frame.f_code
        if co.co_name == '<module>':
            items = {k: v for k, v in frame.f_locals.items() if not k.startswith('__')}
        else:
            names = set(co.co_varnames) | set(co.co_cellvars)
            items = {k: v for k, v in frame.f_locals.items() if k in names}
        return {k: srepr(v) for k, v in items.items() if not isinstance(v, SKIP_TYPES)}

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
        # ジェネレーター式・内包表記のフレーム（<genexpr> など）は内部の動きなので対象外
        # （PyVisualizer はジェネレーター式をその場で全部計算し、内包表記の中もチェックしない）
        if frame.f_code.co_name in ('<genexpr>', '<listcomp>', '<dictcomp>', '<setcomp>'):
            return None
        if event == 'call':
            prev[id(frame)] = {}
        elif event == 'line' and last_line.get(id(frame)) == frame.f_lineno:
            # 同じ行の line イベントが続くのは、行の中で後ろへ戻ったとき（内包表記の繰り返し）。CPython 3.12 は内包表記を
            # 呼び出し元のフレームの中で実行する（PEP 709）ので、ここでは内包表記の変数が一時的に見える。チェックしない
            pass
        elif event in ('line', 'return'):
            check(frame)
            if event == 'return':
                prev.pop(id(frame), None)
                last_line.pop(id(frame), None)
        if event == 'line':
            last_line[id(frame)] = frame.f_lineno
        return tracer

    # input() は、端末と同じく読んだ行を表示する形にする（tools/run_echo.py と同じ。ADR-007）
    def echo_input(prompt=''):
        sys.stdout.write(str(prompt))
        line = sys.stdin.readline()
        if not line:
            raise EOFError('EOF when reading a line')
        return line.rstrip('\n')
    builtins.input = echo_input
    g = {'__name__': '__main__', '__builtins__': builtins}
    error = None
    out, sys.stdout = sys.stdout, io.StringIO()   # プログラムの print は JSON と混ぜない
    sys.settrace(tracer)
    try:
        exec(code, g)
    except SystemExit:
        pass   # exit()・quit() は正常な終わり（PyVisualizer も同じ。ADR-011）
    except BaseException as e:  # noqa: BLE001  例外で終わるプログラムも、そこまでの変化を出す
        error = type(e).__name__
    finally:
        sys.settrace(None)
        sys.stdout = out
    json.dump({'changes': changes, 'error': error}, sys.stdout, ensure_ascii=False)


if __name__ == '__main__':
    main()
