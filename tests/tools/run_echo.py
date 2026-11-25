"""run_echo.py — input() を「端末と同じく、読んだ行をプロンプトの後に表示する」形にしてプログラムを実行する

  python3 -I tests/tools/run_echo.py <program.py> < input.txt

PyVisualizer の input() は、画面の入力欄の行を読み、端末と同じく読んだ行をコンソールに表示する（ADR-007）。
標準入力をリダイレクトした CPython は読んだ行を表示しないので、CPython との比較ではこの形にそろえる。
"""
import builtins
import runpy
import sys


def echo_input(prompt=''):
    sys.stdout.write(str(prompt))
    line = sys.stdin.readline()
    if not line:
        raise EOFError('EOF when reading a line')
    line = line.rstrip('\n')
    sys.stdout.write(line + '\n')
    return line


def main():
    builtins.input = echo_input
    path = sys.argv[1]
    sys.argv = sys.argv[1:]
    runpy.run_path(path, run_name='__main__')


if __name__ == '__main__':
    main()
