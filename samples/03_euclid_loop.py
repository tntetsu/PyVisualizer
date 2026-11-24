x = 851
y = 629
while y > 0:
    x, y = y, x % y
gcd = x
print(gcd)
