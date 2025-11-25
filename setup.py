from setuptools import setup, find_packages

setup(
    name="sstv-robot36",
    version="1.0.0",
    description="SSTV Robot36 encoder and decoder",
    author="SSTV Robot36 Project",
    packages=find_packages(),
    install_requires=[
        "numpy>=1.21.0",
        "scipy>=1.7.0",
        "Pillow>=9.0.0",
    ],
    entry_points={
        "console_scripts": [
            "sstv-robot36=cli:main",
        ],
    },
    python_requires=">=3.8",
)
