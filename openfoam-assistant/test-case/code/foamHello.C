#include "fvCFD.H"
#include "IOdictionary.H"

int main(int argc, char *argv[])
{
    #include "setRootCase.H"
    #include "createTime.H"
    #include "createMesh.H"

    IOdictionary transportProperties
    (
        IOobject
        (
            "transportProperties",
            runTime.constant(),
            mesh,
            IOobject::MUST_READ_IF_MODIFIED,
            IOobject::NO_WRITE
        )
    );

    const dimensionedScalar nu(transportProperties.lookup("nu"));

    Info<< "nu = " << nu << endl;
    Info<< "mesh cells = " << mesh.cells().size() << endl;

    Info<< "End\n" << endl;
    return 0;
}
