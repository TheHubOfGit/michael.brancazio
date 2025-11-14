//
//  LunarClone-Bridging-Header.h
//  LunarClone
//
//  Bridging header to expose C DDC communication functions to Swift
//

#ifndef LunarClone_Bridging_Header_h
#define LunarClone_Bridging_Header_h

// Import C headers for DDC communication
#import "DDCCommunication.h"

// IOKit includes
#import <IOKit/IOKitLib.h>
#import <IOKit/graphics/IOGraphicsLib.h>
#import <IOKit/i2c/IOI2CInterface.h>

// Carbon includes for hotkeys
#import <Carbon/Carbon.h>

#endif /* LunarClone_Bridging_Header_h */ 