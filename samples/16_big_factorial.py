def factorial(n):
    result = 1
    for i in range(1, n + 1):
        result *= i
    return result

big = factorial(25)
print(big)
print(len(str(big)), big % 1000)
