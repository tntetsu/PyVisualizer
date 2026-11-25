import math
from math import sqrt, pi as PI, floor
import math as m

name = input("名前: ")
age = int(input("年齢: "))
scores = [int(s) for s in input().split()]
print(f"{name} は {age} 歳", sum(scores) / len(scores), max(scores))
print(sqrt(16), PI, floor(-2.5), math.ceil(2.1), math.gcd(84, 36), math.factorial(20), m.factorial(25))
print(math.isqrt(99), math.comb(10, 3), math.perm(5, 2), math.trunc(-3.7), math.hypot(3, 4), math.fabs(-2))
print(round(math.log(100, 10), 6), math.log2(1024), math.log10(1000), round(math.sin(PI / 2), 6), math.isclose(0.1 + 0.2, 0.3))
print(math.inf > 10 ** 100, math.e > 2.7, math.pow(2, 10), math.floor(7), type(math.floor(2.5)).__name__)
line = input()
while line != "end":
    print("echo:", line)
    line = input()
