package com.touchgrass.touchgrass

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/** Exposes the hand-written Android bridge module to React Native. */
class TouchGrassPackage : ReactPackage {
    // This package has no custom UI widgets, so only the native service module is registered.
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(TouchGrassAndroidModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
