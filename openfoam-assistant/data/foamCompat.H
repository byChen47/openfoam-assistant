// OpenFOAM Assistant — IntelliSense 兼容头文件(自动强制包含,仅供代码分析)
//
// 目的:让 VS Code 的 C/C++ 扩展(cpptools)识别 OpenFOAM 常用标识符,
//       避免 Info、nl、endl、forAll 等被误报为“未定义”。
//
// 在线模式(已接入真实 OpenFOAM 头文件):下面与真实头文件一致的
//   extern 声明属于合法冗余声明,不会与 Ostream.H / messageStream.H /
//   error.H / IOstreams.H / stdFoam.H 中的定义冲突。
// 离线模式(定义 FOAM_ASSISTANT_OFFLINE):额外提供最小占位类型,
//   让没有安装 OpenFOAM 时也能消除大部分“未定义”误报。

#ifndef FOAM_ASSISTANT_COMPAT_H
#define FOAM_ASSISTANT_COMPAT_H

namespace Foam
{
    // 输出常量(与 Ostream.H 中的 constexpr char 定义一致)
    extern const char tab;
    extern const char nl;

    // 前置声明(与真实头文件中的类一致)
    class messageStream;
    class error;
    class IOerror;
    class Ostream;
    class OSstream;
    class prefixOSstream;

    // 全局输出/错误流对象(与 messageStream.H / IOstreams.H / error.H 一致)
    extern messageStream Info;
    extern messageStream InfoErr;
    extern messageStream Warning;
    extern messageStream SeriousError;
    extern error   FatalError;
    extern IOerror FatalIOError;
    extern OSstream Sout;
    extern OSstream Serr;
    extern prefixOSstream Pout;
    extern prefixOSstream Perr;

    // 换行流操作(与 Ostream.H 中的 inline endl 声明一致)
    Ostream& endl(Ostream& os);
}

// 与 fvCFD.H 末尾的 using namespace Foam; 等效,让 Info/nl/endl 等可直接使用
using namespace Foam;

// 遍历宏(与 stdFoam.H 中的定义 token 完全一致,#ifndef 避免重复定义告警)
#ifndef forAll
#define forAll(list, i) \
    for (Foam::label i=0; i<(list).size(); ++i)
#endif
#ifndef forAllReverse
#define forAllReverse(list, i) \
    for (Foam::label i=(list).size()-1; i>=0; --i)
#endif
#ifndef forAllIter
#define forAllIter(Container,container,iter)                                   \
    for                                                                        \
    (                                                                          \
        Container::iterator iter = (container).begin();                        \
        iter != (container).end();                                             \
        ++iter                                                                 \
    )
#endif
#ifndef forAllConstIter
#define forAllConstIter(Container,container,iter)                              \
    for                                                                        \
    (                                                                          \
        Container::const_iterator iter = (container).cbegin();                 \
        iter != (container).cend();                                            \
        ++iter                                                                 \
    )
#endif

// 离线模式:真实 OpenFOAM 头文件不可用时,提供最小占位定义
#ifdef FOAM_ASSISTANT_OFFLINE
namespace Foam
{
    using label = int;

    class Ostream
    {
    public:
        Ostream& operator<<(const char*) { return *this; }
        Ostream& operator<<(char) { return *this; }
        Ostream& operator<<(bool) { return *this; }
        Ostream& operator<<(int) { return *this; }
        Ostream& operator<<(unsigned int) { return *this; }
        Ostream& operator<<(long) { return *this; }
        Ostream& operator<<(unsigned long) { return *this; }
        Ostream& operator<<(long long) { return *this; }
        Ostream& operator<<(unsigned long long) { return *this; }
        Ostream& operator<<(float) { return *this; }
        Ostream& operator<<(double) { return *this; }
        template<class T> Ostream& operator<<(const T&) { return *this; }
        void endl() {}
    };

    class messageStream : public Ostream {};
    class error : public Ostream {};
    class IOerror : public Ostream {};
    class OSstream : public Ostream {};
    class prefixOSstream : public Ostream {};

    inline Ostream& endl(Ostream& os)
    {
        os.endl();
        return os;
    }

    // 离线占位宏(在线时由 error.H 等真实头文件提供)
    #define FatalErrorInFunction FatalError
    #define FatalErrorInFile FatalError
    #define FatalIOErrorInFunction FatalIOError
    #define FatalIOErrorInFile FatalIOError
    #define WarningInFunction Warning
    #define WarningInFile Warning
    #define InfoInFunction Info
    #define InfoInFile Info
    #define SeriousErrorInFunction SeriousError
    #define SeriousErrorInFile SeriousError

    inline void notImplemented(const char*)
    {}
    #define NotImplemented notImplemented(__FUNCTION__)
}
#endif // FOAM_ASSISTANT_OFFLINE

#endif // FOAM_ASSISTANT_COMPAT_H
