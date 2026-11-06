using System;
using System.IO;
class UpdateInstallerFixture {
  static int Main(string[] args) {
    string root=Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
    if(args.Length==0){File.WriteAllText(Path.Combine(root,"restarted.txt"),"started");return 0;}
    File.WriteAllLines(Path.Combine(root,"arguments.txt"),args);
    if(File.Exists(Path.Combine(root,"fail.txt")))return 42;
    // NSIS treats everything after the final /D= as the destination, including spaces.
    string command=Environment.CommandLine;
    int start=command.IndexOf("/D=",StringComparison.Ordinal);
    if(start<0)return 43;
    string dir=command.Substring(start+3);Directory.CreateDirectory(Path.Combine(dir,"runtime"));
    File.WriteAllText(Path.Combine(dir,"runtime","package.json"),"{\"version\":\"1.0.4\"}");return 0;
  }
}
